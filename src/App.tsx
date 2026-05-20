import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { ThemeProvider } from "./context/ThemeContext";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { FolderPicker } from "./components/layout/FolderPicker";
import { Editor } from "./components/editor/Editor";
import { SettingsPage } from "./components/settings";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { SpinnerIcon } from "./components/icons";

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

  // Cmd+P / Ctrl+P to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(true);
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
          Initializing SimpleMD...
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
