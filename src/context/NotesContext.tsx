import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { Note, NoteMetadata } from "../types/note";
import * as notesService from "../services/notes";
import { listen } from "@tauri-apps/api/event";

interface NotesContextValue {
  notes: NoteMetadata[];
  selectedNoteId: string | null;
  currentNote: Note | null;
  notesFolder: string | null;
  isLoading: boolean;
  selectNote: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  createNoteInFolder: (folderPath: string) => Promise<void>;
  saveNote: (content: string) => Promise<Note | null>;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<void>;
  refreshNotes: () => Promise<void>;
  setNotesFolder: (path: string) => Promise<void>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  renameFolder: (oldPath: string, newName: string) => Promise<void>;
  renameNote: (id: string, newName: string) => Promise<void>;
  moveNote: (id: string, targetFolder: string) => Promise<string>;
  moveFolder: (path: string, targetParent: string) => Promise<void>;
}

const NotesContext = createContext<NotesContextValue | null>(null);

function isBlankDraft(content: string): boolean {
  return content.replace(/&nbsp;|&#160;/g, " ").trim().length === 0;
}

export function useNotes() {
  const context = useContext(NotesContext);
  if (!context) throw new Error("useNotes must be used within NotesProvider");
  return context;
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [notesFolder, setNotesFolderState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const folder = await notesService.getNotesFolder();
        setNotesFolderState(folder);
        if (folder) {
          const list = await notesService.listNotes();
          setNotes(list);
          await notesService.startFileWatcher().catch(console.error);
        }
      } catch {
        // stay in no-folder state
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const refreshNotes = useCallback(async () => {
    if (!notesFolder) return;
    try {
      const list = await notesService.listNotes();
      setNotes(list);
    } catch (err) {
      console.error("Failed to refresh notes:", err);
    }
  }, [notesFolder]);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let debounceTimer: number | null = null;

    async function setupListener() {
      try {
        unlistenFn = await listen("file-changed", () => {
          if (debounceTimer) {
            window.clearTimeout(debounceTimer);
          }
          debounceTimer = window.setTimeout(async () => {
            await refreshNotes();
          }, 300);
        });
      } catch (err) {
        console.error("Failed to listen to file-changed event:", err);
      }
    }

    if (notesFolder) {
      setupListener();
    }

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
    };
  }, [notesFolder, refreshNotes]);

  const selectNote = useCallback(async (id: string) => {
    setSelectedNoteId(id);
    try {
      const note = await notesService.readNote(id);
      setCurrentNote(note);
    } catch (err) {
      console.error("Failed to read note:", err);
    }
  }, []);

  const noteIdSet = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);

  const saveNote = useCallback(async (content: string) => {
    if (!selectedNoteId && isBlankDraft(content)) return null;
    try {
      const updated = await notesService.saveNote(selectedNoteId, content);
      setCurrentNote(updated);
      const isNewNote = updated.id !== selectedNoteId || !noteIdSet.has(updated.id);
      if (updated.id !== selectedNoteId) {
        setSelectedNoteId(updated.id);
      }
      if (isNewNote) {
        await refreshNotes();
      }
      return updated;
    } catch (err) {
      console.error("Failed to save note:", err);
      return null;
    }
  }, [noteIdSet, selectedNoteId, refreshNotes]);

  const createNoteCommon = useCallback(async (targetFolder?: string) => {
    try {
      const note = await notesService.createNote(targetFolder);
      setSelectedNoteId(note.id);
      setCurrentNote(note);
      await refreshNotes();
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  }, [refreshNotes]);

  const createNote = useCallback(() => createNoteCommon(), [createNoteCommon]);
  const createNoteInFolder = useCallback(
    (folderPath: string) => createNoteCommon(folderPath),
    [createNoteCommon],
  );

  const deleteNote = useCallback(async (id: string) => {
    try {
      await notesService.deleteNote(id);
      if (selectedNoteId === id) {
        setSelectedNoteId(null);
        setCurrentNote(null);
      }
      await refreshNotes();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  }, [selectedNoteId, refreshNotes]);

  const duplicateNote = useCallback(async (id: string) => {
    try {
      const original = await notesService.readNote(id);
      const lastSlash = id.lastIndexOf("/");
      const folder = lastSlash > 0 ? id.substring(0, lastSlash) : undefined;
      const newNote = await notesService.createNote(folder);
      const duplicatedContent = original.content.replace(/^# (.+)$/m, (_, title) => `# ${title} (Copy)`);
      await notesService.saveNote(newNote.id, duplicatedContent || original.content);
      await refreshNotes();
    } catch (err) {
      console.error("Failed to duplicate note:", err);
    }
  }, [refreshNotes]);

  const setNotesFolder = useCallback(async (path: string) => {
    try {
      setIsLoading(true);
      setSelectedNoteId(null);
      setCurrentNote(null);
      setNotes([]);
      await notesService.setNotesFolder(path);
      setNotesFolderState(path);
      const list = await notesService.listNotes();
      setNotes(list);
      await notesService.startFileWatcher().catch(console.error);
    } catch (err) {
      console.error("Failed to set notes folder:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createFolder = useCallback(async (parentPath: string, name: string) => {
    const folderPath = parentPath ? `${parentPath}/${name}` : name;
    try {
      await notesService.createFolder(folderPath);
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  }, []);

  const deleteFolder = useCallback(async (path: string) => {
    try {
      await notesService.deleteFolder(path);
      await refreshNotes();
    } catch (err) {
      console.error("Failed to delete folder:", err);
    }
  }, [refreshNotes]);

  const renameFolder = useCallback(async (oldPath: string, newName: string) => {
    try {
      await notesService.renameFolder(oldPath, newName);
      await refreshNotes();
    } catch (err) {
      console.error("Failed to rename folder:", err);
    }
  }, [refreshNotes]);

  const renameNote = useCallback(async (id: string, newName: string) => {
    try {
      const newId = await notesService.renameNote(id, newName);
      if (selectedNoteId === id) {
        setSelectedNoteId(newId);
        const note = await notesService.readNote(newId);
        setCurrentNote(note);
      }
      await refreshNotes();
    } catch (err) {
      console.error("Failed to rename note:", err);
      throw err;
    }
  }, [selectedNoteId, refreshNotes]);

  const moveNote = useCallback(async (id: string, targetFolder: string) => {
    const newId = await notesService.moveNote(id, targetFolder);
    if (selectedNoteId === id) {
      setSelectedNoteId(newId);
      const note = await notesService.readNote(newId);
      setCurrentNote(note);
    }
    await refreshNotes();
    return newId;
  }, [selectedNoteId, refreshNotes]);

  const moveFolder = useCallback(async (path: string, targetParent: string) => {
    await notesService.moveFolder(path, targetParent);
    await refreshNotes();
  }, [refreshNotes]);

  const value = useMemo<NotesContextValue>(
    () => ({
      notes, selectedNoteId, currentNote, notesFolder, isLoading,
      selectNote, createNote, createNoteInFolder, saveNote, deleteNote,
      duplicateNote, refreshNotes, setNotesFolder,
      createFolder, deleteFolder, renameFolder, renameNote, moveNote, moveFolder,
    }),
    [notes, selectedNoteId, currentNote, notesFolder, isLoading,
     selectNote, createNote, createNoteInFolder, saveNote, deleteNote,
     duplicateNote, refreshNotes, setNotesFolder,
     createFolder, deleteFolder, renameFolder, renameNote, moveNote, moveFolder],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useOptionalNotes(): NotesContextValue | null {
  const context = useContext(NotesContext);
  return context;
}
