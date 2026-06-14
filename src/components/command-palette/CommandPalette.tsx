import { useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTheme } from "../../context/ThemeContext";
import type { Editor } from "@tiptap/react";
import { CommandItem } from "../ui";
import {
  SettingsIcon,
  SwatchIcon,
  AddNoteIcon,
  MarkdownIcon,
  FolderIcon,
  KeyboardIcon,
  OutlineIcon,
  InfoIcon,
  DownloadIcon,
} from "../icons";
import { mod, shift } from "../../lib/platform";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  editorRef?: React.RefObject<Editor | null>;
}

export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
  onOpenShortcuts,
  editorRef,
}: CommandPaletteProps) {
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    return [
      {
        id: "new-file",
        label: "New File",
        shortcut: `${mod} N`,
        icon: <AddNoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("editor-new-file"));
          onClose();
        },
      },
      {
        id: "open-file",
        label: "Open File",
        shortcut: `${mod} O`,
        icon: <FolderIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("editor-open-file"));
          onClose();
        },
      },
      {
        id: "save-file",
        label: "Save",
        shortcut: `${mod} S`,
        icon: <DownloadIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("editor-save-file"));
          onClose();
        },
      },
      {
        id: "toggle-source",
        label: "Toggle Markdown Source",
        shortcut: `${mod} ${shift} M`,
        icon: <MarkdownIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("toggle-source-mode"));
          onClose();
        },
      },
      {
        id: "toggle-outline",
        label: "Toggle Outline",
        shortcut: `${mod} ${shift} O`,
        icon: <OutlineIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("toggle-outline"));
          onClose();
        },
      },
      {
        id: "toggle-status-bar",
        label: "Toggle Status Bar",
        icon: <InfoIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("toggle-status-bar"));
          onClose();
        },
      },
      {
        id: "keyboard-shortcuts",
        label: "Keyboard Shortcuts",
        shortcut: `${mod} /`,
        icon: <KeyboardIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          onOpenShortcuts?.();
          onClose();
        },
      },
      {
        id: "settings",
        label: "Settings",
        shortcut: `${mod} ,`,
        icon: <SettingsIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          onOpenSettings?.();
          onClose();
        },
      },
      {
        id: "theme-light",
        label: "Switch Theme to Light Mode",
        icon: <SwatchIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          setTheme("light");
          onClose();
        },
      },
      {
        id: "theme-dark",
        label: "Switch Theme to Dark Mode",
        icon: <SwatchIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          setTheme("dark");
          onClose();
        },
      },
    ];
  }, [onClose, onOpenSettings, onOpenShortcuts, setTheme, editorRef]);

  // Memoize filtered commands
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const queryLower = query.toLowerCase();
    return commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(queryLower),
    );
  }, [query, commands]);

  // Memoize command items (notes moved to QuickOpen panel)
  const allItems = useMemo(() => {
    return filteredCommands.map((cmd) => ({
      type: "command" as const,
      id: cmd.id,
      label: cmd.label,
      shortcut: cmd.shortcut,
      icon: cmd.icon,
      action: cmd.action,
      preview: undefined as string | undefined,
    }));
  }, [filteredCommands]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Global keyboard listener: Escape closes the palette
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler as EventListener, { capture: true });
    return () => window.removeEventListener("keydown", handler as EventListener, { capture: true });
  }, [open, onClose]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedItem = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      selectedItem?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (allItems[selectedIndex]) {
            allItems[selectedIndex].action();
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    },
    [allItems, selectedIndex, onClose],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div className="fixed inset-0 z-40 bg-black/40 pointer-events-auto" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pointer-events-none">
      <div className="relative w-full max-w-2xl bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down flex flex-col pointer-events-auto">
        {/* Search input */}
        <div className="border-b border-border flex-none">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full px-4.5 py-3.5 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto max-h-96 p-2.5 flex-1">
          {allItems.length === 0 ? (
            <div className="text-sm font-medium opacity-50 text-text-muted p-2">
              No results found
            </div>
          ) : (
            <div className="space-y-0.5">
              {allItems.map((item, i) => (
                <div key={item.id} data-index={i}>
                  <CommandItem
                    label={item.label}
                    shortcut={item.shortcut}
                    icon={item.icon}
                    isSelected={selectedIndex === i}
                    onClick={item.action}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
