import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ThemeProvider } from "./context/ThemeContext";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { FolderPicker } from "./components/layout/FolderPicker";
import { Editor } from "./components/editor/Editor";
import { SettingsPage } from "./components/settings";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { QuickOpen } from "./components/command-palette/QuickOpen";
import { SpinnerIcon } from "./components/icons";

function AppContent() {
  const { notesFolder, isLoading } = useNotes();
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [view, setView] = useState<"main" | "settings">("main");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);
  const openSettings = useCallback(() => setView("settings"), []);
  const closeSettings = useCallback(() => setView("main"), []);

  const handleEditorReady = useCallback((editor: TiptapEditor | null) => {
    editorRef.current = editor;
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeQuickOpen = useCallback(() => setQuickOpenOpen(false), []);

  // Ctrl+P → QuickOpen, Ctrl+Shift+P → Command Palette, Ctrl+B → toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setQuickOpenOpen(false);
        setPaletteOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        setQuickOpenOpen(true);
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
        className={`transition-[width,opacity,transform] duration-200 ease-out overflow-hidden ${sidebarVisible ? "opacity-100 translate-x-0 w-64" : "opacity-0 -translate-x-4 w-0 pointer-events-none"}`}
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
      <QuickOpen
        open={quickOpenOpen}
        onClose={closeQuickOpen}
      />
    </div>
  );
}

function App() {

  // Cmd/Ctrl+W — close window
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

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={700}>
        <NotesProvider>
          <AppContent />
        </NotesProvider>
      </TooltipProvider>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
