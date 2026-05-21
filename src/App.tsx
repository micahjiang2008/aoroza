import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider } from "./context/ThemeContext";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { FolderPicker } from "./components/layout/FolderPicker";
import { Editor } from "./components/editor/Editor";
import { SettingsPage } from "./components/settings";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { PreviewApp } from "./components/preview/PreviewApp";
import { SpinnerIcon } from "./components/icons";

// Detect preview mode from window label (synchronous, no flicker)
function isPreviewWindow(): boolean {
  try {
    return getCurrentWindow().label.startsWith("preview-");
  } catch {
    return false;
  }
}

// Get preview file path via IPC (async)
async function getPreviewFilePath(): Promise<string | null> {
  try {
    const file = await invoke<string | null>("get_preview_file");
    return file;
  } catch {
    return null;
  }
}

function AppContent() {
  const { notesFolder, isLoading } = useNotes();
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [view, setView] = useState<"main" | "settings">("main");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);
  const openSettings = useCallback(() => setView("settings"), []);
  const closeSettings = useCallback(() => setView("main"), []);

  const handleEditorReady = useCallback((editor: TiptapEditor | null) => {
    editorRef.current = editor;
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Cmd+P / Ctrl+P to open command palette; Ctrl+B to toggle sidebar (only when editor not focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        // Only toggle sidebar if the editor is not focused (ProseMirror handles Ctrl+B for bold)
        const el = document.activeElement;
        if (el && !el.closest(".ProseMirror")) {
          e.preventDefault();
          e.stopPropagation();
          setSidebarVisible((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="h-full min-h-0 flex items-center justify-center bg-bg-secondary">
        <div className="text-text-muted/70 text-sm flex items-center gap-1.5 font-medium">
          <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
          Initializing Aoroza...
        </div>
      </div>
    );
  }

  if (!notesFolder) {
    return <FolderPicker />;
  }

  if (view === "settings") {
    return <SettingsPage onBack={closeSettings} />;
  }

  return (
    <div className="h-full min-h-0 flex bg-bg text-text overflow-hidden">
      <div
        data-sidebar
        className={`transition-all duration-500 ease-out overflow-hidden ${sidebarVisible ? "opacity-100 translate-x-0 w-64" : "opacity-0 -translate-x-4 w-0 pointer-events-none"}`}
      >
        <Sidebar onOpenSettings={openSettings} />
      </div>
      <Editor onToggleSidebar={toggleSidebar} sidebarVisible={sidebarVisible} onEditorReady={handleEditorReady} />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        onOpenSettings={openSettings}
        onOpenShortcuts={() => { openSettings(); }}
        editorRef={editorRef}
      />
    </div>
  );
}

function App() {
  const isPreview = isPreviewWindow();
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  // Fetch the preview file path on mount
  useEffect(() => {
    if (isPreview) {
      getPreviewFilePath().then(setPreviewFile).catch(() => setPreviewFile(null));
    }
  }, [isPreview]);

  // Cmd/Ctrl+W — close window (works in both preview and folder mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        getCurrentWindow().close().catch(console.error);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Preview mode: lightweight editor without sidebar, search, git
  if (isPreview) {
    if (previewFile === null) {
      // Still loading the file path — show spinner
      return (
        <ThemeProvider>
          <div className="h-full min-h-0 flex items-center justify-center bg-bg text-text-muted">
            <SpinnerIcon className="w-5 h-5 animate-spin stroke-[1.5]" />
          </div>
        </ThemeProvider>
      );
    }
    return (
      <ThemeProvider>
        <Toaster />
        <TooltipProvider>
          <PreviewApp filePath={previewFile} />
        </TooltipProvider>
      </ThemeProvider>
    );
  }

  // Folder mode: full app with sidebar, etc.
  return (
    <ThemeProvider>
      <TooltipProvider>
        <NotesProvider>
          <AppContent />
        </NotesProvider>
      </TooltipProvider>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
