import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useNotes } from "../../context/NotesContext";
import { Button } from "../ui";
import { Input } from "../ui";
import {
  FolderIcon,
  FoldersIcon,
  ChevronRightIcon,
  XIcon,
} from "../icons";
import type { Settings } from "../../types/note";

export function GeneralSettingsSection() {
  const { notesFolder, setNotesFolder } = useNotes();

  const [noteTemplate, setNoteTemplate] = useState<string>("Untitled");
  const [previewNoteName, setPreviewNoteName] = useState<string>("Untitled");

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const settings = await invoke<Settings>("get_settings");
        const template = settings.defaultNoteName || "Untitled";
        setNoteTemplate(template);
        const preview = await invoke<string>("preview_note_name", { template });
        setPreviewNoteName(preview);
      } catch (error) {
        console.error("Failed to load template:", error);
      }
    };
    loadTemplate();
  }, []);

  useEffect(() => {
    const updatePreview = async () => {
      try {
        const preview = await invoke<string>("preview_note_name", {
          template: noteTemplate,
        });
        setPreviewNoteName(preview);
      } catch (error) {
        setPreviewNoteName("Invalid template");
      }
    };
    const timer = setTimeout(updatePreview, 300);
    return () => clearTimeout(timer);
  }, [noteTemplate]);

  const handleSaveTemplate = async () => {
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: { ...settings, defaultNoteName: noteTemplate || undefined },
      });
      toast.success("Default name saved");
    } catch (error) {
      console.error("Failed to save default name:", error);
      toast.error("Failed to save default name");
    }
  };

  const handleChangeFolder = async () => {
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
  };

  const handleOpenFolder = async () => {
    if (!notesFolder) return;
    try {
      await invoke("open_in_file_manager", { path: notesFolder });
    } catch (err) {
      console.error("Failed to open folder:", err);
      toast.error("Failed to open folder");
    }
  };

  const formatPath = (path: string | null): string => {
    if (!path) return "Not set";
    const maxLength = 50;
    if (path.length <= maxLength) return path;
    const start = path.slice(0, 20);
    const end = path.slice(-25);
    return `${start}...${end}`;
  };

  return (
    <div className="space-y-8 py-8">
      {/* Folder Location */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Folder Location</h2>
        <p className="text-sm text-text-muted mb-4">
          Your notes are stored as markdown files in this folder
        </p>
        <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] border border-border mb-2.5">
          <div className="p-2 rounded-md bg-bg-muted">
            <FolderIcon className="w-4.5 h-4.5 stroke-[1.5] text-text-muted" />
          </div>
          <p
            className="text-sm text-text-muted truncate"
            title={notesFolder || undefined}
          >
            {formatPath(notesFolder)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={handleChangeFolder}
            variant="outline"
            size="md"
            className="gap-1.25"
          >
            <FoldersIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            Change Folder
          </Button>
          {notesFolder && (
            <Button
              onClick={handleOpenFolder}
              variant="ghost"
              size="md"
              className="gap-1.25 text-text"
            >
              Open Folder
            </Button>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Default Note Name */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Default Note Name</h2>
        <p className="text-sm text-text-muted mb-4">
          Customize the default name when creating a new note
        </p>
        <div className="space-y-2">
          <div>
            <Input
              type="text"
              value={noteTemplate}
              onChange={(e) => setNoteTemplate(e.target.value)}
              onBlur={handleSaveTemplate}
              placeholder="Untitled"
            />
          </div>
          <div className="text-2xs text-text-muted font-mono p-2 rounded-md bg-bg-muted mb-4">
            Preview: {previewNoteName}
          </div>

          {/* Template Tags Reference */}
          <details className="text-sm">
            <summary className="cursor-pointer text-text-muted hover:text-text select-none flex items-center gap-1 font-medium">
              <ChevronRightIcon className="w-3.5 h-3.5 stroke-2 transition-transform [[open]>&]:rotate-90" />
              Add template tags to your name
            </summary>
            <div className="mt-2 space-y-1.5 pl-2 text-text-muted">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                <code>{"{timestamp}"}</code>
                <span>1739586000</span>
                <code>{"{date}"}</code>
                <span>2026-02-15</span>
                <code>{"{time}"}</code>
                <span>14-30-45</span>
                <code>{"{year}"}</code>
                <span>2026</span>
                <code>{"{month}"}</code>
                <span>02</span>
                <code>{"{day}"}</code>
                <span>15</span>
                <code>{"{monthName}"}</code>
                <span>February</span>
                <code>{"{monthShort}"}</code>
                <span>Feb</span>
                <code>{"{weekday}"}</code>
                <span>Sunday</span>
                <code>{"{weekdayShort}"}</code>
                <span>Sun</span>
                <code>{"{dayOrdinal}"}</code>
                <span>15th</span>
                <code>{"{counter}"}</code>
                <span>1, 2, 3...</span>
              </div>
              <p className="text-xs mt-2 pt-2 border-t border-border">
                Examples: <code>Note-{"{year}-{month}-{day}"}</code>
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Ignored Folders */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Ignored Folders</h2>
        <p className="text-sm text-text-muted mb-4">
          Folders matching these names are excluded from note discovery and search indexing
        </p>
        <IgnoredFoldersEditor />
      </section>
    </div>
  );
}

function IgnoredFoldersEditor() {
  const [patterns, setPatterns] = useState<string[] | null>(null);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { notesFolder, refreshNotes } = useNotes();

  useEffect(() => {
    setPatterns(null);
    Promise.all([
      invoke<Settings>("get_settings"),
      invoke<string[]>("get_default_ignored_patterns"),
    ])
      .then(([settings, defaultPatterns]) => {
        setDefaults(defaultPatterns);
        setPatterns(settings.ignoredPatterns ?? defaultPatterns);
      })
      .catch((error) => {
        console.error("Failed to load ignored patterns:", error);
        setPatterns([]);
      });
  }, [notesFolder]);

  const save = async (updated: string[] | null) => {
    setIsSaving(true);
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: { ...settings, ignoredPatterns: updated ?? undefined },
      });
      setPatterns(updated ?? defaults);
      refreshNotes();
    } catch {
      toast.error("Failed to save ignored folders");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdd = () => {
    const trimmed = newPattern.trim();
    if (!trimmed || !patterns) return;
    if (/[/\\]/.test(trimmed)) {
      toast.error("Ignore patterns must be single directory names (no paths)");
      return;
    }
    if (patterns.includes(trimmed)) {
      toast.error("Already in the list");
      return;
    }
    setNewPattern("");
    save([...patterns, trimmed]);
  };

  const handleRemove = (pattern: string) => {
    if (!patterns) return;
    save(patterns.filter((p) => p !== pattern));
  };

  const handleReset = () => {
    save(null);
  };

  const isDefault =
    patterns !== null &&
    patterns.length === defaults.length &&
    patterns.every((p, i) => p === defaults[i]);

  if (patterns === null) {
    return <div className="text-sm text-text-muted py-2">Loading...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {patterns.map((pattern) => (
          <span
            key={pattern}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.75 rounded-md bg-bg-muted text-2xs font-mono"
          >
            {pattern}
            <button
              type="button"
              aria-label={`Remove ${pattern}`}
              onClick={() => handleRemove(pattern)}
              disabled={isSaving}
              className="p-0.5 rounded hover:bg-bg-muted text-text-muted hover:text-text cursor-pointer"
            >
              <XIcon className="w-3 h-3 stroke-[1.7]" />
            </button>
          </span>
        ))}
        {patterns.length === 0 && (
          <span className="text-sm text-text-muted">
            No folders ignored — all markdown files will be indexed
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Add folder name..."
          className="flex-1"
          disabled={isSaving}
        />
        <Button
          onClick={handleAdd}
          variant="outline"
          size="sm"
          className="h-10"
          disabled={isSaving || !newPattern.trim()}
        >
          Add
        </Button>
      </div>
      {!isDefault && (
        <button
          type="button"
          onClick={handleReset}
          disabled={isSaving}
          className="text-sm text-text-muted hover:text-text cursor-pointer font-medium"
        >
          Reset to defaults
        </button>
      )}
    </div>
  );
}
