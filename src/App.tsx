import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Editor } from "./components/editor/Editor";
import { SettingsPage } from "./components/settings";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { RecentFiles } from "./components/command-palette/RecentFiles";

function AppContent() {
  const [view, setView] = useState<"main" | "settings">("main");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recentFilesOpen, setRecentFilesOpen] = useState(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  const openSettings = useCallback(() => setView("settings"), []);
  const closeSettings = useCallback(() => setView("main"), []);

  const handleEditorReady = useCallback((editor: TiptapEditor | null) => {
    editorRef.current = editor;
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeRecentFiles = useCallback(() => setRecentFilesOpen(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        e.stopPropagation();
        setRecentFilesOpen(true);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (view === "settings") {
    return <SettingsPage onBack={closeSettings} />;
  }

  return (
    <div className="h-full min-h-0 flex bg-bg text-text overflow-hidden">
      <Editor onEditorReady={handleEditorReady} />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        onOpenSettings={openSettings}
        onOpenShortcuts={() => { openSettings(); }}
        editorRef={editorRef}
      />
      <RecentFiles
        open={recentFilesOpen}
        onClose={closeRecentFiles}
        onFileOpened={(path, content) => {
          window.dispatchEvent(new CustomEvent("editor-load-file", { detail: { path, content } }));
        }}
      />
    </div>
  );
}

function App() {
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
        <AppContent />
      </TooltipProvider>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
