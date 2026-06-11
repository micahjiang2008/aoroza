import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNotes } from "../../context/NotesContext";
import { CommandItem } from "../ui";

interface QuickOpenProps {
  open: boolean;
  onClose: () => void;
}

export function QuickOpen({ open, onClose }: QuickOpenProps) {
  const { notes, selectNote } = useNotes();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fuzzy filter notes by filename or title
  const filteredNotes = useMemo(() => {
    if (!query.trim()) return notes;
    const q = query.toLowerCase();
    return notes.filter((n) => {
      const filename = (n.id.split("/").pop() || n.id).toLowerCase();
      const title = n.title.toLowerCase();
      return filename.includes(q) || title.includes(q);
    });
  }, [query, notes]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Global Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [open, onClose]);

  // Reset selection on query change
  useEffect(() => { setSelectedIndex(0); }, [query]);

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current) {
      listRef.current.querySelector(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); e.stopPropagation(); setSelectedIndex((i) => Math.min(i + 1, filteredNotes.length - 1)); break;
        case "ArrowUp": e.preventDefault(); e.stopPropagation(); setSelectedIndex((i) => Math.max(i - 1, 0)); break;
        case "Enter":
          e.preventDefault(); e.stopPropagation();
          if (filteredNotes[selectedIndex]) { selectNote(filteredNotes[selectedIndex].id); onClose(); }
          break;
        case "Escape": e.preventDefault(); e.stopPropagation(); onClose(); break;
      }
    },
    [filteredNotes, selectedIndex, selectNote, onClose],
  );

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 pointer-events-auto" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pointer-events-none">
        <div className="relative w-full max-w-2xl bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down flex flex-col pointer-events-auto">
          <div className="border-b border-border flex-none">
            <input
              ref={inputRef}
              type="text" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search notes..."
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full px-4.5 py-3.5 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50"
            />
          </div>
          <div ref={listRef} className="overflow-y-auto max-h-96 p-2.5 flex-1">
            {filteredNotes.length === 0 ? (
              <div className="text-sm font-medium opacity-50 text-text-muted p-2">No results</div>
            ) : (
              filteredNotes.map((note, i) => {
                const filename = note.id.split("/").pop() || note.id;
                const parent = note.id.includes("/") ? note.id.split("/").slice(0, -1).join("/") : null;
                return (
                  <div key={note.id} data-index={i}>
                    <CommandItem
                      label={filename}
                      subtitle={parent || undefined}
                      iconText={filename.charAt(0).toUpperCase()}
                      variant="note"
                      isSelected={selectedIndex === i}
                      onClick={() => { selectNote(note.id); onClose(); }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
