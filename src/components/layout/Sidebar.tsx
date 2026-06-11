import { useCallback } from "react";
import { toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNotes } from "../../context/NotesContext";
import { NoteList } from "../notes/NoteList";
import { Footer } from "./Footer";
import { invoke } from "@tauri-apps/api/core";
import { IconButton, Tooltip } from "../ui";
import { PlusIcon, AddNoteIcon, FolderPlusIcon, FoldersIcon } from "../icons";
import { mod, isMac } from "../../lib/platform";
import { FolderNameDialog } from "../notes/FolderNameDialog";
import { useState } from "react";

interface SidebarProps {
  onOpenSettings?: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { createNote, createFolder, notes, selectedNoteId, notesFolder, setNotesFolder } = useNotes();
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogParent, setFolderDialogParent] = useState("");

  const handleChangeFolder = useCallback(async () => {
    try {
      const selected = await invoke<string | null>("open_folder_dialog", {
        defaultPath: notesFolder || null,
      });
      if (selected) {
        await setNotesFolder(selected);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
      toast.error("Failed to select folder");
    }
  }, [notesFolder, setNotesFolder]);

  const handleNewFolder = useCallback(() => {
    const lastSlash = selectedNoteId?.lastIndexOf("/") ?? -1;
    setFolderDialogParent(lastSlash > 0 ? selectedNoteId!.substring(0, lastSlash) : "");
    setFolderDialogOpen(true);
  }, [selectedNoteId]);

  const handleFolderConfirm = useCallback(async (name: string) => {
    try {
      await createFolder(folderDialogParent, name);
      setFolderDialogOpen(false);
    } catch (error) {
      console.error("Failed to create folder:", error);
      toast.error("Failed to create folder");
    }
  }, [createFolder, folderDialogParent]);

  return (
    <div className="relative w-64 h-full bg-bg-secondary border-r border-border flex flex-col select-none">
      {/* <div className="h-11 shrink-0" data-tauri-drag-region /> */}

      <div className="h-11 shrink-0 flex items-center justify-between px-3 border-b border-border" data-tauri-drag-region>
        <div className="flex items-center gap-1">
          <div className="font-medium text-base">Notes</div>
          <div className="text-text-muted font-medium text-2xs min-w-4.75 h-4.75 flex items-center justify-center px-1 bg-bg-muted rounded-sm mt-0.5 pt-px">
            {notes.length}
          </div>
        </div>
        <div className="flex items-center gap-px">
          <DropdownMenu.Root open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <IconButton variant="ghost">
                <PlusIcon className="w-5.25 h-5.25 stroke-[1.4]" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-40 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
                sideOffset={5} align="end"
                onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={() => createNote()}>
                  <AddNoteIcon className="w-4 h-4 stroke-[1.6]" />
                  <span className="flex-1">New Note</span>
                  <kbd className="text-xs text-text-muted ml-2">{mod}{isMac ? "" : "+"}N</kbd>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={handleNewFolder}>
                  <FolderPlusIcon className="w-4 h-4 stroke-[1.6]" />
                  New Folder
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Tooltip content="Change Folder">
            <IconButton variant="ghost" onClick={handleChangeFolder}>
              <FoldersIcon className="w-5 h-5 stroke-[1.4]" />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <NoteList />
      </div>

      <Footer notesFolder={notesFolder} onOpenSettings={onOpenSettings} />

      <FolderNameDialog
        open={folderDialogOpen} onOpenChange={setFolderDialogOpen}
        onConfirm={handleFolderConfirm} title="Create new folder"
        description="Enter a name for your new folder" confirmLabel="Create" />
    </div>
  );
}
