import { useCallback, useMemo, useState, useEffect, useRef, memo } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useNotes } from "../../context/NotesContext";
import { buildFolderTree, countNotesInFolder, getVisibleItems, type TreeItem } from "../../lib/folderTree";
import { FolderNameDialog } from "./FolderNameDialog";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "../ui";
import {
  ChevronRightIcon, ChevronDownIcon, AddNoteIcon, FolderPlusIcon,
  PencilIcon, TrashIcon, NoteIcon, CopyIcon,
} from "../icons";
import * as notesService from "../../services/notes";
import type { FolderNode, NoteMetadata } from "../../types/note";

const STORAGE_KEY = "aoroza:collapsedFolders";

const menuItemClass = "px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2 rounded-sm";
const menuSeparatorClass = "h-px bg-border my-1";

function loadCollapsed(): Set<string> {
  try { const s = localStorage.getItem(STORAGE_KEY); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
}
function saveCollapsed(folders: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...folders])); } catch {}
}

function fileNameFromId(id: string): string {
  return id.split('/').pop() || id;
}

interface FileItemProps {
  note: NoteMetadata;
  depth: number;
  isSelected: boolean;
  onNoteClick: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onDuplicate: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
}

const FileItem = memo(function FileItem({
  note, depth, isSelected, onNoteClick, onRename, onDuplicate, onDelete,
}: FileItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const handleClick = useCallback(() => onNoteClick(note.id), [onNoteClick, note.id]);

  useEffect(() => { if (isSelected) itemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [isSelected]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div ref={itemRef}
          className={`flex items-center gap-1.5 py-1 cursor-pointer rounded-md select-none transition-colors ${isSelected ? "bg-bg-muted" : "hover:bg-bg-muted"}`}
          style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "8px" }}
          onClick={handleClick} role="button" tabIndex={-1}>
          <NoteIcon className="w-4 h-4 stroke-[1.6] opacity-50 shrink-0" />
          <span className="text-sm text-text truncate">{fileNameFromId(note.id)}</span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-44 bg-bg border border-border rounded-md shadow-lg py-1 z-50">
          <ContextMenu.Item className={menuItemClass} onSelect={() => onRename(note.id, fileNameFromId(note.id))}>
            <PencilIcon className="w-4 h-4 stroke-[1.6]" />Rename
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItemClass} onSelect={() => onDuplicate(note.id).catch((e) => toast.error(`Failed to duplicate: ${e?.message || e}`))}>
            <CopyIcon className="w-4 h-4 stroke-[1.6]" />Duplicate
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparatorClass} />
          <ContextMenu.Item className={`${menuItemClass} text-red-500 hover:text-red-500 focus:text-red-500`} onSelect={() => onDelete(note.id)}>
            <TrashIcon className="w-4 h-4 stroke-[1.6]" />Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

interface FolderItemProps {
  folder: FolderNode;
  depth: number;
  collapsedFolders: Set<string>;
  onToggleCollapse: (path: string) => void;
  selectedNoteId: string | null;
  onNoteClick: (id: string) => void;
  onCreateNoteHere: (path: string) => void;
  onNewSubfolder: (parentPath: string) => void;
  onRenameFolder: (path: string, currentName: string) => void;
  onDeleteFolder: (path: string) => void;
  onRenameNote: (id: string, currentName: string) => void;
  onDuplicateNote: (id: string) => Promise<void>;
  onDeleteNote: (id: string) => void;
}

const FolderItemComponent = memo(function FolderItem({
  folder, depth, collapsedFolders, onToggleCollapse, selectedNoteId,
  onNoteClick, onCreateNoteHere, onNewSubfolder, onRenameFolder, onDeleteFolder,
  onRenameNote, onDuplicateNote, onDeleteNote,
}: FolderItemProps) {
  const isCollapsed = collapsedFolders.has(folder.path);
  const isEmpty = countNotesInFolder(folder) === 0 && folder.children.length === 0;
  const handleClick = useCallback(() => onToggleCollapse(folder.path), [onToggleCollapse, folder.path]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <div className="flex items-center gap-1.5 py-1 cursor-pointer rounded-md select-none transition-colors hover:bg-bg-muted"
            style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "8px" }}
            onClick={handleClick} role="button" tabIndex={-1}>
            {isCollapsed
              ? <ChevronRightIcon className="w-4 h-4 stroke-[1.6] text-text-muted/60 shrink-0" />
              : <ChevronDownIcon className="w-4 h-4 stroke-[1.6] text-text-muted/60 shrink-0" />}
            <span className="text-sm text-text-muted truncate">{folder.name}</span>
          </div>
          {!isCollapsed && (
            <div className="flex flex-col gap-0.5">
              {folder.children.map((child) => (
                <FolderItemComponent key={child.path} folder={child} depth={depth + 1}
                  collapsedFolders={collapsedFolders} onToggleCollapse={onToggleCollapse}
                  selectedNoteId={selectedNoteId}
                  onNoteClick={onNoteClick} onCreateNoteHere={onCreateNoteHere}
                  onNewSubfolder={onNewSubfolder} onRenameFolder={onRenameFolder}
                  onDeleteFolder={onDeleteFolder} onRenameNote={onRenameNote}
                  onDuplicateNote={onDuplicateNote}
                  onDeleteNote={onDeleteNote} />
              ))}
              {folder.notes.map((note) => (
                <FileItem key={note.id} note={note} depth={depth + 1}
                  isSelected={selectedNoteId === note.id}
                  onNoteClick={onNoteClick} onRename={onRenameNote} onDuplicate={onDuplicateNote} onDelete={onDeleteNote} />
              ))}
              {isEmpty && <div className="text-sm text-text-muted/50 py-1 select-none" style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}>Empty</div>}
            </div>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-44 bg-bg border border-border rounded-md shadow-lg py-1 z-50">
          <ContextMenu.Item className={menuItemClass} onSelect={() => onCreateNoteHere(folder.path)}>
            <AddNoteIcon className="w-4 h-4 stroke-[1.6]" />New Note
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItemClass} onSelect={() => onNewSubfolder(folder.path)}>
            <FolderPlusIcon className="w-4 h-4 stroke-[1.6]" />New Subfolder
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparatorClass} />
          <ContextMenu.Item className={menuItemClass} onSelect={() => { const p = folder.path.split("/"); onRenameFolder(folder.path, p[p.length - 1]); }}>
            <PencilIcon className="w-4 h-4 stroke-[1.6]" />Rename
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparatorClass} />
          <ContextMenu.Item className={`${menuItemClass} text-red-500 hover:text-red-500 focus:text-red-500`} onSelect={() => onDeleteFolder(folder.path)}>
            <TrashIcon className="w-4 h-4 stroke-[1.6]" />Delete Folder
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

export function FolderTreeView() {
  const { notes, selectedNoteId, selectNote, createNoteInFolder, createFolder,
    deleteFolder, renameFolder, renameNote, duplicateNote, deleteNote } = useNotes();

  const [collapsedFolders, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [delDialogOpen, setDelDialogOpen] = useState(false);
  const [folderToDel, setFolderToDel] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<string | null>(null);
  const [renameDefault, setRenameDefault] = useState("");
  const [noteRenameOpen, setNoteRenameOpen] = useState(false);
  const [noteToRename, setNoteToRename] = useState<string | null>(null);
  const [noteRenameDefault, setNoteRenameDefault] = useState("");
  const [subfolderOpen, setSubfolderOpen] = useState(false);
  const [subfolderParent, setSubfolderParent] = useState("");
  const [noteDelOpen, setNoteDelOpen] = useState(false);
  const [noteToDel, setNoteToDel] = useState<string | null>(null);
  const [knownFolders, setKnownFolders] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveCollapsed(collapsedFolders); }, [collapsedFolders]);

  useEffect(() => {
    notesService.listFolders().then(setKnownFolders).catch(() => setKnownFolders([]));
  }, [notes]);

  const tree = useMemo(() => buildFolderTree(notes, knownFolders), [notes, knownFolders]);

  const toggleCollapse = useCallback((path: string) => {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  }, []);

  const handleNewSubfolder = useCallback((parent: string) => { setSubfolderParent(parent); setSubfolderOpen(true); }, []);
  const handleRenameFolder = useCallback((path: string, name: string) => { setFolderToRename(path); setRenameDefault(name); setRenameOpen(true); }, []);
  const handleDeleteFolder = useCallback((path: string) => { setFolderToDel(path); setDelDialogOpen(true); }, []);
  const handleRenameNote = useCallback((id: string, name: string) => { setNoteToRename(id); setNoteRenameDefault(name); setNoteRenameOpen(true); }, []);

  const handleRenameConfirm = useCallback(async (name: string) => {
    if (folderToRename) { try { await renameFolder(folderToRename, name); setFolderToRename(null); setRenameOpen(false); } catch (e) { toast.error("Failed to rename folder"); console.error(e); } }
  }, [folderToRename, renameFolder]);

  const handleNoteRenameConfirm = useCallback(async (name: string) => {
    if (noteToRename) { try { await renameNote(noteToRename, name); setNoteToRename(null); setNoteRenameOpen(false); } catch (e) { toast.error("Failed to rename note"); console.error(e); } }
  }, [noteToRename, renameNote]);

  const handleSubfolderConfirm = useCallback(async (name: string) => {
    try { await createFolder(subfolderParent, name); setSubfolderOpen(false); } catch (e) { toast.error("Failed to create folder"); console.error(e); }
  }, [subfolderParent, createFolder]);

  const handleDeleteConfirm = useCallback(async () => {
    if (folderToDel) { try { await deleteFolder(folderToDel); setFolderToDel(null); setDelDialogOpen(false); } catch (e) { toast.error("Failed to delete folder"); console.error(e); } }
  }, [folderToDel, deleteFolder]);

  const visibleItems = useMemo(() => getVisibleItems(tree, collapsedFolders), [tree, collapsedFolders]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  useEffect(() => { if (selectedNoteId) setFocusedKey(`note:${selectedNoteId}`); }, [selectedNoteId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) return;
    if (e.key === "Escape") { containerRef.current?.blur(); return; }
    if (visibleItems.length === 0) return;
    e.preventDefault(); e.stopPropagation();

    const idx = visibleItems.findIndex((i: TreeItem) => (i.type === "note" ? `note:${i.id}` : `folder:${i.path}`) === focusedKey);
    let newIdx = idx;
    if (e.key === "ArrowDown") newIdx = idx < visibleItems.length - 1 ? idx + 1 : 0;
    else if (e.key === "ArrowUp") newIdx = idx > 0 ? idx - 1 : visibleItems.length - 1;
    else if (e.key === "Enter") {
      const item = visibleItems[idx];
      if (item?.type === "folder") { toggleCollapse(item.path); return; }
      return;
    }
    const item = visibleItems[newIdx];
    if (!item) return;
    setFocusedKey(item.type === "note" ? `note:${item.id}` : `folder:${item.path}`);
    if (item.type === "note") selectNote(item.id);
  }, [visibleItems, focusedKey, selectNote, toggleCollapse]);

  useEffect(() => {
    const h = () => containerRef.current?.focus();
    window.addEventListener("focus-note-list", h);
    return () => window.removeEventListener("focus-note-list", h);
  }, []);

  if (notes.length === 0) {
    return <div className="p-4 text-center text-sm text-text-muted select-none">No notes yet</div>;
  }

  return (
    <>
      <div ref={containerRef} tabIndex={0} data-note-list data-folder-tree
        className="group/notelist flex flex-col gap-0.5 p-1.5 outline-none"
        onKeyDown={handleKeyDown}>
        {tree.folders.map((f) => (
          <FolderItemComponent key={f.path} folder={f} depth={0} collapsedFolders={collapsedFolders}
            onToggleCollapse={toggleCollapse} selectedNoteId={selectedNoteId}
            onNoteClick={selectNote} onCreateNoteHere={createNoteInFolder}
            onNewSubfolder={handleNewSubfolder} onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder} onRenameNote={handleRenameNote} onDuplicateNote={duplicateNote}
            onDeleteNote={(id) => { setNoteToDel(id); setNoteDelOpen(true); }} />
        ))}
        {tree.rootNotes.map((n) => (
          <FileItem key={n.id} note={n} depth={0} isSelected={selectedNoteId === n.id}
            onNoteClick={selectNote} onRename={handleRenameNote} onDuplicate={duplicateNote}
            onDelete={(id) => { setNoteToDel(id); setNoteDelOpen(true); }} />
        ))}
      </div>

      <AlertDialog open={delDialogOpen} onOpenChange={setDelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the folder and all notes inside it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="text-red-500">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={noteDelOpen} onOpenChange={setNoteDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (noteToDel) { try { await deleteNote(noteToDel); setNoteToDel(null); setNoteDelOpen(false); } catch {} } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FolderNameDialog open={renameOpen} onOpenChange={setRenameOpen}
        onConfirm={handleRenameConfirm} title="Rename Folder"
        description="Enter a new name for the folder" confirmLabel="Rename"
        defaultValue={renameDefault} />

      <FolderNameDialog open={subfolderOpen} onOpenChange={setSubfolderOpen}
        onConfirm={handleSubfolderConfirm} title="Create new subfolder"
        description="Enter a name for your new subfolder" confirmLabel="Create" />

      <FolderNameDialog open={noteRenameOpen} onOpenChange={setNoteRenameOpen}
        onConfirm={handleNoteRenameConfirm} title="Rename Note"
        description="Enter a new name for the note" confirmLabel="Rename"
        defaultValue={noteRenameDefault} />
    </>
  );
}
