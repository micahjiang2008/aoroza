import { useState, useEffect, useCallback, useRef } from "react";
import { CommandItem } from "../ui";
import { openFileDialog, readFile, getSettings, updateSettings, type Settings } from "../../services/app";

interface RecentFilesProps {
  open: boolean;
  onClose: () => void;
  onFileOpened: (path: string, content: string) => void;
}

export function RecentFiles({ open, onClose, onFileOpened }: RecentFilesProps) {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recent files when opened
  useEffect(() => {
    if (!open) return;
    getSettings().then((s: Settings) => {
      setRecentFiles(s.recentFiles ?? []);
    });
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h, { capture: true });
    return () => window.removeEventListener("keydown", h, { capture: true });
  }, [open, onClose]);

  const addRecentFile = useCallback(async (path: string) => {
    const settings = await getSettings();
    const existing = settings.recentFiles ?? [];
    const updated = [path, ...existing.filter((f) => f !== path)].slice(0, 10);
    await updateSettings({ ...settings, recentFiles: updated });
    setRecentFiles(updated);
  }, []);

  const openRecentFile = useCallback(async (path: string) => {
    try {
      const content = await readFile(path);
      await addRecentFile(path);
      onFileOpened(path, content);
      onClose();
    } catch (err) {
      console.error("Failed to open recent file:", err);
    }
  }, [addRecentFile, onFileOpened, onClose]);

  const openSystemDialog = useCallback(async () => {
    const path = await openFileDialog();
    if (!path) return;
    try {
      const content = await readFile(path);
      await addRecentFile(path);
      onFileOpened(path, content);
      onClose();
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [addRecentFile, onFileOpened, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, recentFiles.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex < recentFiles.length) {
        openRecentFile(recentFiles[selectedIndex]);
      } else {
        openSystemDialog();
      }
    }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }, [recentFiles, selectedIndex, openRecentFile, openSystemDialog, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 pointer-events-auto" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pointer-events-none">
        <div className="relative w-full max-w-2xl bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down flex flex-col pointer-events-auto">
          <div className="border-b border-border flex-none">
            <input
              ref={inputRef}
              type="text" value=""
              readOnly
              onKeyDown={handleKeyDown}
              placeholder="Recent files — ↑↓ to select, Enter to open, Esc to close"
              autoComplete="off" spellCheck={false}
              className="w-full px-4.5 py-3.5 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50"
            />
          </div>
          <div className="overflow-y-auto max-h-96 p-2.5 flex-1">
            {recentFiles.length === 0 ? (
              <div className="text-sm font-medium opacity-50 text-text-muted p-2">No recent files</div>
            ) : (
              recentFiles.map((path, i) => {
                const filename = path.split(/[/\\]/).pop() || path;
                return (
                  <div key={path} data-index={i}>
                    <CommandItem
                      label={filename}
                      subtitle={path}
                      iconText={filename.charAt(0).toUpperCase()}
                      variant="note"
                      isSelected={selectedIndex === i}
                      onClick={() => openRecentFile(path)}
                    />
                  </div>
                );
              })
            )}
            <div data-index={recentFiles.length}>
              <CommandItem
                label="Open other file..."
                iconText="+"
                variant="note"
                isSelected={selectedIndex === recentFiles.length}
                onClick={openSystemDialog}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
