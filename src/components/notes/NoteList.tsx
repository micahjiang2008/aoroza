import { useNotes } from "../../context/NotesContext";
import { FolderTreeView } from "./FolderTreeView";

export function NoteList() {
  const { isLoading, notes } = useNotes();

  if (isLoading && notes.length === 0) {
    return <div className="p-4 text-center text-text-muted select-none">Loading...</div>;
  }

  return <FolderTreeView />;
}
