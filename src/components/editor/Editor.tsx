import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  useEditor, EditorContent, ReactRenderer, ReactNodeViewRenderer,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import LinkExtension from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { lowlight } from "./lowlight";
import { CodeBlockView } from "./CodeBlockView";
import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { mod, shift, alt, isMac } from "../../lib/platform";
import { useTheme } from "../../context/ThemeContext";
import { Frontmatter } from "./Frontmatter";
import { BlockMathEditor } from "./BlockMathEditor";
import { LinkEditor } from "./LinkEditor";
import { SearchToolbar } from "./SearchToolbar";
import { SlashCommand } from "./SlashCommand";
import { ScratchBlockMath } from "./MathExtensions";
import { cn } from "../../lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { downloadPdf, downloadMarkdown } from "../../services/pdf";
import { IconButton, ToolbarButton, Tooltip } from "../ui";
import * as appService from "../../services/app";
import {
  BoldIcon, ItalicIcon, StrikethroughIcon,
  Heading1Icon, Heading2Icon, Heading3Icon, Heading4Icon,
  ListIcon, ListOrderedIcon, CheckSquareIcon, QuoteIcon,
  CodeIcon, InlineCodeIcon, BlockMathIcon, SeparatorIcon,
  LinkIcon, ImageIcon, TableIcon,
  SpinnerIcon, CopyIcon, ShareIcon, DownloadIcon, BracketsIcon,
  FileIcon, FolderIcon,
  MarkdownIcon, MarkdownOffIcon,
  OutlineIcon, InfoIcon, MinusIcon, MaximizeIcon, XIcon,
} from "../icons";
import { Outline } from "./Outline";

// Icons kept for hidden toolbar buttons — restore when uncommenting header/format-bar JSX
const _hiddenIcons = { CopyIcon, ShareIcon, MarkdownIcon, MarkdownOffIcon, DownloadIcon, OutlineIcon, InfoIcon, TableIcon, BracketsIcon };
void _hiddenIcons;

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isAllowedUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

const searchHighlightPluginKey = new PluginKey("searchHighlight");

interface EditorProps {
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  onEditorReady?: (editor: TiptapEditor | null) => void;
  onSaveToFolder?: () => void;
  saveToFolderDisabled?: boolean;
}

// GridPicker component for table insertion
interface GridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

function GridPicker({ onSelect }: GridPickerProps) {
  const [hovered, setHovered] = useState({ row: 3, col: 3 });

  return (
    <>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 25 }).map((_, i) => {
          const row = Math.floor(i / 5) + 1;
          const col = (i % 5) + 1;
          const isHighlighted = row <= hovered.row && col <= hovered.col;

          return (
            <div
              key={i}
              className={cn(
                "w-5.5 h-5.5 border rounded cursor-pointer transition-colors",
                isHighlighted
                  ? "bg-accent/20 border-accent/50"
                  : "border-border hover:border-accent/50",
              )}
              onMouseEnter={() => setHovered({ row, col })}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>
      <p className="text-xs text-center mt-2 text-text-muted">
        {hovered.row} × {hovered.col} table
      </p>
    </>
  );
}

export function Editor({
  onEditorReady,
}: EditorProps) {
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [hasExternalChange, setHasExternalChange] = useState(false);
  const lastMtimeRef = useRef<number>(0);
  const { textDirection } = useTheme();
  const [, setIsSaving] = useState(false);
  const [, setIsDirty] = useState(false);
  const [selectionKey, setSelectionKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<Array<{ from: number; to: number }>>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [statusBarVisible, setStatusBarVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const linkPopupRef = useRef<TippyInstance | null>(null);
  const blockMathPopupRef = useRef<TippyInstance | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const needsSaveRef = useRef(false);
  const loadedNoteIdRef = useRef<string | null>(null);
  const sourceTimeoutRef = useRef<number | null>(null);
  const isSettingContentRef = useRef(false);

  const minimizeWindow = useCallback(() => {
    getCurrentWindow().minimize().catch(console.error);
  }, []);

  const toggleMaximizeWindow = useCallback(() => {
    getCurrentWindow().toggleMaximize().catch(console.error);
  }, []);

  const closeWindow = useCallback(() => {
    getCurrentWindow().close().catch(console.error);
  }, []);

  const getMarkdown = useCallback((editorInstance: TiptapEditor | null) => {
    if (!editorInstance) return "";
    const manager = editorInstance.storage.markdown?.manager;
    if (manager) {
      let markdown = manager.serialize(editorInstance.getJSON());
      markdown = markdown.replace(/&nbsp;|&#160;/g, " ");
      return markdown;
    }
    return editorInstance.getText();
  }, []);

  const findMatches = useCallback((query: string, editorInstance: TiptapEditor | null) => {
    if (!editorInstance || !query.trim()) return [];
    const doc = editorInstance.state.doc;
    const lowerQuery = query.toLowerCase();
    const matches: Array<{ from: number; to: number }> = [];
    doc.descendants((node, nodePos) => {
      if (node.isText && node.text) {
        const lowerText = node.text.toLowerCase();
        let searchPos = 0;
        while (searchPos < lowerText.length && matches.length < 500) {
          const index = lowerText.indexOf(lowerQuery, searchPos);
          if (index === -1) break;
          matches.push({ from: nodePos + index, to: nodePos + index + query.length });
          searchPos = index + 1;
        }
      }
    });
    return matches;
  }, []);

  const updateSearchDecorations = useCallback(
    (matches: Array<{ from: number; to: number }>, currentIndex: number, editorInstance: TiptapEditor | null) => {
      if (!editorInstance) return;
      try {
        const decorations: Decoration[] = [];
        matches.forEach((match, index) => {
          decorations.push(Decoration.inline(match.from, match.to, {
            class: index === currentIndex ? "search-match-active" : "search-match",
          }));
        });
        const decorationSet = DecorationSet.create(editorInstance.state.doc, decorations);
        const tr = editorInstance.state.tr.setMeta(searchHighlightPluginKey, { decorationSet });
        editorInstance.view.dispatch(tr);
        if (matches[currentIndex]) {
          const match = matches[currentIndex];
          const { node } = editorInstance.view.domAtPos(match.from);
          const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch {}
    }, []);

  const saveFile = useCallback(async (markdown: string) => {
    setIsDirty(false);
    setIsSaving(true);
    try {
      let filePath = currentFilePath;
      if (filePath) {
        const mtime = await appService.fileMtime(filePath);
        if (mtime != null && mtime !== lastMtimeRef.current && lastMtimeRef.current !== 0) {
          setHasExternalChange(true);
          setIsSaving(false);
          return;
        }
        setHasExternalChange(false);
        await appService.writeFile(filePath, markdown);
        needsSaveRef.current = false;
        // Re-read mtime AFTER writing so next check matches
        const newMtime = await appService.fileMtime(filePath);
        if (newMtime != null) lastMtimeRef.current = newMtime;
      } else {
        filePath = await appService.saveFileDialog(markdown, "Untitled.md");
        if (filePath) setCurrentFilePath(filePath);
      }
      // Add to recent files
      if (filePath) {
        const settings = await appService.getSettings();
        const existing = settings.recentFiles ?? [];
        const recentFiles = [filePath, ...existing.filter((f) => f !== filePath)].slice(0, 10);
        await appService.updateSettings({ ...settings, recentFiles });
      }
    } catch (err) {
      toast.error("Failed to save file");
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  }, [currentFilePath]);

  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (needsSaveRef.current && editorRef.current) {
      const markdown = getMarkdown(editorRef.current);
      await saveFile(markdown);
    }
  }, [saveFile, getMarkdown, currentFilePath]);

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (!currentFilePath) return;  // don't auto-save untitled files
    setIsDirty(true);
    needsSaveRef.current = true;
    saveTimeoutRef.current = window.setTimeout(async () => {
      if (!needsSaveRef.current || !editorRef.current) return;
      const markdown = getMarkdown(editorRef.current);
      await saveFile(markdown);
    }, 500);
  }, [saveFile, getMarkdown, currentFilePath]);

  const closeBlockMathPopup = useCallback(() => {
    if (blockMathPopupRef.current) { blockMathPopupRef.current.destroy(); blockMathPopupRef.current = null; }
  }, []);

  const handleEditBlockMath = useCallback((pos: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    if (linkPopupRef.current) { linkPopupRef.current.destroy(); linkPopupRef.current = null; }
    closeBlockMathPopup();
    const node = currentEditor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "blockMath") return;

    const virtualElement = {
      getBoundingClientRect: () => {
        const nodeDom = currentEditor.view.nodeDOM(pos);
        if (nodeDom instanceof HTMLElement) return nodeDom.getBoundingClientRect();
        const start = currentEditor.view.coordsAtPos(pos);
        const end = currentEditor.view.coordsAtPos(pos + node.nodeSize);
        return {
          width: Math.max(2, Math.min(start.left, end.left) - Math.max(start.right, end.right)),
          height: Math.max(20, Math.min(start.top, end.top) - Math.max(start.bottom, end.bottom)),
          top: Math.min(start.top, end.top), left: Math.min(start.left, end.left),
          right: Math.max(start.right, end.right), bottom: Math.max(start.bottom, end.bottom),
          x: Math.min(start.left, end.left), y: Math.min(start.top, end.top),
          toJSON: () => ({}),
        } as DOMRect;
      },
    };

    const component = new ReactRenderer(BlockMathEditor, {
      props: {
        initialLatex: String(node.attrs.latex ?? ""),
        onSubmit: (latex: string) => {
          if (!latex.trim()) { toast.error("Please enter a formula."); return; }
          currentEditor.chain().focus().updateBlockMath({ pos, latex: latex.trim() }).setTextSelection(pos + node.nodeSize).run();
          closeBlockMathPopup();
        },
        onCancel: () => {
          currentEditor.chain().focus().setTextSelection(pos + node.nodeSize).run();
          closeBlockMathPopup();
        },
      },
      editor: currentEditor,
    });

    blockMathPopupRef.current = tippy(document.body, {
      getReferenceClientRect: () => virtualElement.getBoundingClientRect() as DOMRect,
      appendTo: () => document.body, content: component.element,
      showOnCreate: true, interactive: true, trigger: "manual",
      placement: "bottom-start", offset: [0, 8],
      onDestroy: () => component.destroy(),
    });
  }, [closeBlockMathPopup]);

  const closeLinkPopup = useCallback(() => {
    if (linkPopupRef.current) { linkPopupRef.current.destroy(); linkPopupRef.current = null; }
  }, []);

  const handleLinkButton = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    closeLinkPopup();
    const { from, to } = currentEditor.state.selection;

    if (currentEditor.isActive("link")) {
      const attrs = currentEditor.getAttributes("link");
      const currentUrl: string = attrs.href || "";
      const virtualElement = {
        getBoundingClientRect: () => {
          const start = currentEditor.view.coordsAtPos(from);
          const end = currentEditor.view.coordsAtPos(to);
          return {
            width: Math.max(2, Math.min(start.left, end.left) - Math.max(start.right, end.right)),
            top: Math.min(start.top, end.top), left: Math.min(start.left, end.left),
            right: Math.max(start.right, end.right), bottom: Math.max(start.bottom, end.bottom),
            y: Math.min(start.top, end.top), x: Math.min(start.left, end.left),
            height: Math.max(20, Math.min(start.top, end.top) - Math.max(start.bottom, end.bottom)),
            toJSON: () => ({}),
          } as DOMRect;
        },
      };
      const component = new ReactRenderer(LinkEditor, {
        props: {
          initialUrl: currentUrl,
          onSubmit: (url: string) => {
            const normalized = normalizeUrl(url);
            if (!normalized) { currentEditor.chain().focus().extendMarkRange("link").unsetLink().run(); }
            else { currentEditor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run(); }
            closeLinkPopup();
          },
          onRemove: () => { currentEditor.chain().focus().extendMarkRange("link").unsetLink().run(); closeLinkPopup(); },
          onCancel: () => { closeLinkPopup(); },
        },
        editor: currentEditor,
      });
      linkPopupRef.current = tippy(document.body, {
        getReferenceClientRect: () => virtualElement.getBoundingClientRect() as DOMRect,
        appendTo: () => document.body, content: component.element,
        showOnCreate: true, interactive: true, trigger: "manual",
        placement: "bottom", onDestroy: () => component.destroy(),
      });
    } else {
      currentEditor.chain().focus().insertContent("[text](url)").run();
      currentEditor.commands.setTextSelection({ from: from + 1, to: from + 5 });
    }
  }, [closeLinkPopup]);

  const handleAddBlockMath = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    closeBlockMathPopup();
    if (linkPopupRef.current) { linkPopupRef.current.destroy(); linkPopupRef.current = null; }
    const { selection } = currentEditor.state;
    const { from, to } = selection;

    if (selection instanceof NodeSelection && selection.node.type.name === "blockMath") {
      handleEditBlockMath(from);
      return;
    }
    if (!to || from === to) {
      const pos = from;
      const component = new ReactRenderer(BlockMathEditor, {
        props: {
          initialLatex: "",
          onSubmit: (latex: string) => {
            if (!latex.trim()) { toast.error("Please enter a formula."); return; }
            currentEditor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
            closeBlockMathPopup();
          },
          onCancel: () => { closeBlockMathPopup(); },
        },
        editor: currentEditor,
      });
      blockMathPopupRef.current = tippy(document.body, {
        getReferenceClientRect: () => currentEditor.view.coordsAtPos(pos) as unknown as DOMRect,
        appendTo: () => document.body, content: component.element,
        showOnCreate: true, interactive: true, trigger: "manual",
        placement: "bottom-start", offset: [0, 8],
        onDestroy: () => component.destroy(),
      });
    }
  }, [closeBlockMathPopup, handleEditBlockMath]);

  const openEditorSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchMatches([]);
      updateSearchDecorations([], 0, editorRef.current);
      return;
    }
    const matches = findMatches(query, editorRef.current);
    setSearchMatches(matches);
    setCurrentMatchIndex(0);
    updateSearchDecorations(matches, 0, editorRef.current);
  }, [findMatches, updateSearchDecorations]);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(next);
    updateSearchDecorations(searchMatches, next, editorRef.current);
  }, [searchMatches, currentMatchIndex, updateSearchDecorations]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prev);
    updateSearchDecorations(searchMatches, prev, editorRef.current);
  }, [searchMatches, currentMatchIndex, updateSearchDecorations]);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    updateSearchDecorations([], 0, editorRef.current);
    editorRef.current?.commands.focus();
  }, [updateSearchDecorations]);

  const handleAddWikilink = useCallback(() => {
    editorRef.current?.chain().focus().insertContent("[[").run();
  }, []);

  const handleImageDialog = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] }],
    });
    if (!selected || typeof selected !== "string") return;
    if (!editorRef.current) return;
    const assetUrl = convertFileSrc(selected);
    editorRef.current.chain().focus().setImage({ src: assetUrl }).run();
  }, []);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => !prev);
  }, []);

  const handleCopyMarkdown = useCallback(async () => {
    if (!editorRef.current) return;
    const md = getMarkdown(editorRef.current);
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Markdown copied");
    } catch {
      toast.error("Failed to copy");
    }
    setCopyMenuOpen(false);
  }, [getMarkdown]);

  const handleCopyPlainText = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      await navigator.clipboard.writeText(editorRef.current.state.doc.textContent);
      toast.success("Plain text copied");
    } catch {
      toast.error("Failed to copy");
    }
    setCopyMenuOpen(false);
  }, []);

  const handleCopyHtml = useCallback(async () => {
    if (!editorRef.current) return;
    const html = editorRef.current.getHTML();
    try {
      await navigator.clipboard.writeText(html);
      toast.success("HTML copied");
    } catch {
      toast.error("Failed to copy");
    }
    setCopyMenuOpen(false);
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      const title = currentFilePath
        ? (currentFilePath.split(/[/\\]/).pop() || "untitled").replace(/\.md$/i, "")
        : "untitled";
      await downloadPdf(ed, title);
      toast.success("PDF saved");
    } catch (err) {
      toast.error("Failed to save PDF");
      console.error(err);
    }
    setCopyMenuOpen(false);
  }, [currentFilePath]);

  const handleDownloadMarkdown = useCallback(async () => {
    if (!editorRef.current) return;
    const md = getMarkdown(editorRef.current);
    const title = currentFilePath
      ? (currentFilePath.split(/[/\\]/).pop() || "untitled").replace(/\.md$/i, "")
      : "untitled";
    try {
      await downloadMarkdown(md, title);
      toast.success("Markdown saved");
    } catch (err) {
      toast.error("Failed to save markdown");
      console.error(err);
    }
    setCopyMenuOpen(false);
  }, [currentFilePath, getMarkdown]);

  // State/functions kept for hidden toolbar buttons — restore when uncommenting header JSX
  void [copyMenuOpen]; void [setCopyMenuOpen];
  void [handleCopyMarkdown, handleCopyPlainText, handleCopyHtml, handleDownloadPdf, handleDownloadMarkdown];

  const editor = useEditor({
    autofocus: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: false, link: false }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading" && node.attrs.level === 1) return "Untitled";
          return "Start writing...";
        },
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-accent underline underline-offset-2 decoration-accent/30 hover:decoration-accent/60" },
      }),
      Image.configure({ inline: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({}),
      Markdown.configure({}),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }).extend({
        addNodeView() { return ReactNodeViewRenderer(CodeBlockView); },
      }),
      ScratchBlockMath.configure({
        onClick: (_node: unknown, pos: number) => handleEditBlockMath(pos),
      }),
      Frontmatter,
      SlashCommand,
      Extension.create({
        name: "selectionChange",
        addKeyboardShortcuts() {
          return {
            "Mod-b": () => this.editor.chain().focus().toggleBold().run(),
            "Mod-i": () => this.editor.chain().focus().toggleItalic().run(),
            "Mod-Shift-s": () => this.editor.chain().focus().toggleStrike().run(),
            "Mod-`": () => this.editor.chain().focus().toggleCode().run(),
            "Mod-f": () => { openEditorSearch(); return true; },
            "Mod-Shift-m": () => { toggleSourceMode(); return true; },
          };
        },
        onSelectionUpdate() { setSelectionKey((k) => k + 1); },
      }),
      Extension.create({
        name: "searchHighlight",
        addProseMirrorPlugins() {
          return [new Plugin({
            key: searchHighlightPluginKey,
            state: {
              init() { return DecorationSet.empty; },
              apply(tr, _old) {
                const meta = tr.getMeta(searchHighlightPluginKey);
                return meta?.decorationSet ?? DecorationSet.empty;
              },
            },
            props: {
              decorations(state) { return this.getState(state); },
            },
          })];
        },
      }),
    ],
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none" },
      handleDOMEvents: { mouseDown: () => { closeLinkPopup(); closeBlockMathPopup(); } },
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement)?.closest?.("a");
        if (link?.href && isAllowedUrlScheme(link.href)) {
          openUrl(link.href);
          return true;
        }
        return false;
      },
    },
    onUpdate: () => {
      if (isSettingContentRef.current) return;
      scheduleSave();
      setSelectionKey((k) => k + 1);
    },
    onSelectionUpdate: () => { closeLinkPopup(); },
  });

  useEffect(() => {
    editorRef.current = editor;
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // Listen for files opened externally (double-click in Explorer)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ path: string; content: string }>("file-opened", (event) => {
        flushPendingSave();
        setCurrentFilePath(event.payload.path);
        setIsDirty(false);
        loadedNoteIdRef.current = event.payload.path;
        isSettingContentRef.current = true;
        editor?.chain().focus().setContent(event.payload.content, { contentType: "markdown" } as any).run();
        isSettingContentRef.current = false;
        // Record mtime
        appService.fileMtime(event.payload.path).then((m) => { if (m != null) lastMtimeRef.current = m; });
        // Add to recent files
        appService.getSettings().then((settings) => {
          const existing = settings.recentFiles ?? [];
          const recentFiles = [event.payload.path, ...existing.filter((f) => f !== event.payload.path)].slice(0, 10);
          appService.updateSettings({ ...settings, recentFiles });
        });
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [editor, flushPendingSave]);

  // Check for external changes when window gains focus
  useEffect(() => {
    const onFocus = async () => {
      if (!currentFilePath || !editorRef.current) return;
      const mtime = await appService.fileMtime(currentFilePath);
      if (mtime == null || mtime === lastMtimeRef.current) return;
      if (!needsSaveRef.current && !hasExternalChange) {
        try {
          const content = await appService.readFile(currentFilePath);
          lastMtimeRef.current = mtime;
          isSettingContentRef.current = true;
          editorRef.current.chain().focus().setContent(content, { contentType: "markdown" } as any).run();
          isSettingContentRef.current = false;
        } catch { /* file may have been deleted */ }
      } else {
        setHasExternalChange(true);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [currentFilePath, getMarkdown]);

  // Poll for external changes while window is focused (every 3s)
  useEffect(() => {
    if (!currentFilePath) return;
    let timer: number;
    let active = true;
    const poll = async () => {
      if (!active || !currentFilePath || !editorRef.current) return;
      const mtime = await appService.fileMtime(currentFilePath);
      if (mtime == null || mtime === lastMtimeRef.current || !active) return;
      if (!needsSaveRef.current && !hasExternalChange) {
        try {
          const content = await appService.readFile(currentFilePath);
          lastMtimeRef.current = mtime;
          isSettingContentRef.current = true;
          editorRef.current.chain().focus().setContent(content, { contentType: "markdown" } as any).run();
          isSettingContentRef.current = false;
        } catch {}
      } else {
        setHasExternalChange(true);
      }
    };
    const onFocus = () => { timer = window.setInterval(poll, 3000); };
    const onBlur = () => { clearInterval(timer); };
    if (document.hasFocus()) onFocus();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur); };
  }, [currentFilePath, getMarkdown]);

  // File open handler
  const handleOpenFile = useCallback(async () => {
    flushPendingSave();
    const path = await appService.openFileDialog();
    if (!path) return;
    try {
      const content = await appService.readFile(path);
      // Add to recent files
      const settings = await appService.getSettings();
      const existing = settings.recentFiles ?? [];
      const recentFiles = [path, ...existing.filter((f) => f !== path)].slice(0, 10);
      await appService.updateSettings({ ...settings, recentFiles });

      setCurrentFilePath(path);
      setIsDirty(false);
      loadedNoteIdRef.current = path;
      isSettingContentRef.current = true;
      editor?.chain().focus().setContent(content, { contentType: "markdown" } as any).run();
      isSettingContentRef.current = false;
      // Record mtime
      appService.fileMtime(path).then((m) => { if (m != null) lastMtimeRef.current = m; });
    } catch (err) {
      toast.error("Failed to open file");
      console.error(err);
    }
  }, [editor, flushPendingSave]);

  // File save handler (Ctrl+S)
  const handleSaveFile = useCallback(async () => {
    if (!editorRef.current) return;
    const markdown = getMarkdown(editorRef.current);
    await saveFile(markdown);
  }, [saveFile, getMarkdown]);

  // New file handler (Ctrl+N)
  const handleNewFile = useCallback(() => {
    flushPendingSave();
    setCurrentFilePath(null);
    loadedNoteIdRef.current = null;
    isSettingContentRef.current = true;
    editor?.chain().clearContent().focus().run();
    isSettingContentRef.current = false;
    setIsDirty(false);
    lastMtimeRef.current = 0;
    setHasExternalChange(false);
  }, [editor, flushPendingSave]);

  // Keyboard shortcuts: Ctrl+O, Ctrl+S, Ctrl+N
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modKey = e.metaKey || e.ctrlKey;
      if (!modKey) return;
      if (e.key === "o" && !e.altKey) { e.preventDefault(); handleOpenFile(); }
      else if (e.key === "s") { e.preventDefault(); handleSaveFile(); }
      else if (e.key === "n") { e.preventDefault(); handleNewFile(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenFile, handleSaveFile, handleNewFile]);

  // Listen for file operation events from Command Palette
  useEffect(() => {
    const onOpen = () => handleOpenFile();
    const onSave = () => handleSaveFile();
    const onNew = () => handleNewFile();
    const onLoadFile = (e: Event) => {
      const { path, content } = (e as CustomEvent).detail as { path: string; content: string };
      flushPendingSave();
      setCurrentFilePath(path);
      setIsDirty(false);
      loadedNoteIdRef.current = path;
      isSettingContentRef.current = true;
      editor?.chain().focus().setContent(content, { contentType: "markdown" } as any).run();
      isSettingContentRef.current = false;
      appService.fileMtime(path).then((m) => { if (m != null) lastMtimeRef.current = m; });
    };
    window.addEventListener("editor-open-file", onOpen);
    window.addEventListener("editor-save-file", onSave);
    window.addEventListener("editor-new-file", onNew);
    window.addEventListener("editor-load-file", onLoadFile);
    return () => {
      window.removeEventListener("editor-open-file", onOpen);
      window.removeEventListener("editor-save-file", onSave);
      window.removeEventListener("editor-new-file", onNew);
      window.removeEventListener("editor-load-file", onLoadFile);
    };
  }, [handleOpenFile, handleSaveFile, handleNewFile, editor, flushPendingSave]);

  useEffect(() => {
    return () => { flushPendingSave(); };
  }, [flushPendingSave]);

  useEffect(() => {
    if (sourceMode && editorRef.current) {
      setSourceContent(getMarkdown(editorRef.current));
    }
  }, [sourceMode, getMarkdown]);

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setSourceContent(value);
    if (sourceTimeoutRef.current) clearTimeout(sourceTimeoutRef.current);
    sourceTimeoutRef.current = window.setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.commands.setContent(value, { contentType: "markdown" } as any);
        scheduleSave();
      }
    }, 300);
  }, [scheduleSave]);

  const toggleOutline = useCallback(() => setOutlineVisible((v) => !v), []);
  const toggleStatusBar = useCallback(() => setStatusBarVisible((v) => !v), []);

  // Listen for toggle-source-mode custom event from command palette
  useEffect(() => {
    const handler = () => toggleSourceMode();
    window.addEventListener("toggle-source-mode", handler);
    return () => window.removeEventListener("toggle-source-mode", handler);
  }, [toggleSourceMode]);

  // Listen for toggle-outline custom event from command palette
  useEffect(() => {
    const handler = () => toggleOutline();
    window.addEventListener("toggle-outline", handler);
    return () => window.removeEventListener("toggle-outline", handler);
  }, [toggleOutline]);

  // Listen for toggle-status-bar custom event from command palette
  useEffect(() => {
    const handler = () => toggleStatusBar();
    window.addEventListener("toggle-status-bar", handler);
    return () => window.removeEventListener("toggle-status-bar", handler);
  }, [toggleStatusBar]);

  // Listen for Ctrl+Shift+O / Cmd+Shift+O keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isO = e.key.toLowerCase() === "o";
      const hasModifiers = (e.ctrlKey && e.shiftKey) || (e.metaKey && e.shiftKey);
      if (isO && hasModifiers) {
        e.preventDefault();
        e.stopPropagation();
        toggleOutline();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleOutline]);

  const isActive = (check: (e: TiptapEditor) => boolean) => editor ? check(editor) : false;

  const charCount = useMemo(() => {
    if (sourceMode) {
      return sourceContent.length;
    }
    if (editor) {
      return editor.state.doc.textContent.length;
    }
    return 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, sourceContent, editor, selectionKey]);

  const readingTime = Math.max(1, Math.ceil(charCount / 350));
  const [conflictMenuOpen, setConflictMenuOpen] = useState(false);

  const handleReloadExternal = useCallback(async () => {
    if (!currentFilePath || !editor) return;
    try {
      const content = await appService.readFile(currentFilePath);
      const mtime = await appService.fileMtime(currentFilePath);
      if (mtime) lastMtimeRef.current = mtime;
      setHasExternalChange(false);
      needsSaveRef.current = false;
      setConflictMenuOpen(false);
      isSettingContentRef.current = true;
      editor.chain().focus().setContent(content, { contentType: "markdown" } as any).run();
      isSettingContentRef.current = false;
    } catch { toast.error("Failed to reload file"); }
  }, [currentFilePath, editor]);

  const handleSaveAsCurrent = useCallback(async () => {
    if (!editor) return;
    setConflictMenuOpen(false);
    const markdown = getMarkdown(editor);
    const path = await appService.saveFileDialog(markdown, "Untitled.md");
    if (path) {
      setCurrentFilePath(path);
      setHasExternalChange(false);
      needsSaveRef.current = false;
      const newMtime = await appService.fileMtime(path);
      if (newMtime) lastMtimeRef.current = newMtime;
    }
  }, [editor, getMarkdown]);

  const handleOverwriteExternal = useCallback(async () => {
    if (!currentFilePath || !editor) return;
    setConflictMenuOpen(false);
    const markdown = getMarkdown(editor);
    await appService.writeFile(currentFilePath, markdown);
    needsSaveRef.current = false;
    setHasExternalChange(false);
    const newMtime = await appService.fileMtime(currentFilePath);
    if (newMtime) lastMtimeRef.current = newMtime;
  }, [currentFilePath, editor, getMarkdown]);

  // Toolbar items — must match scratch's FormatBar exactly
  const toolbarButtons: Array<{
    key: string;
    active: boolean;
    icon: React.ReactNode;
    action: () => void;
    title: string;
  } | "sep"> = [
    { key: "bold", active: isActive((e) => e.isActive("bold")), icon: <BoldIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleBold().run(), title: `Bold (${mod}${isMac ? "" : "+"}B)` },
    { key: "italic", active: isActive((e) => e.isActive("italic")), icon: <ItalicIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleItalic().run(), title: `Italic (${mod}${isMac ? "" : "+"}I)` },
    { key: "strike", active: isActive((e) => e.isActive("strike")), icon: <StrikethroughIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleStrike().run(), title: `Strikethrough (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}S)` },
    "sep",
    { key: "h1", active: isActive((e) => e.isActive("heading", { level: 1 })), icon: <Heading1Icon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleHeading({ level: 1 }).run(), title: `Heading 1 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}1)` },
    { key: "h2", active: isActive((e) => e.isActive("heading", { level: 2 })), icon: <Heading2Icon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleHeading({ level: 2 }).run(), title: `Heading 2 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}2)` },
    { key: "h3", active: isActive((e) => e.isActive("heading", { level: 3 })), icon: <Heading3Icon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleHeading({ level: 3 }).run(), title: `Heading 3 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}3)` },
    { key: "h4", active: isActive((e) => e.isActive("heading", { level: 4 })), icon: <Heading4Icon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleHeading({ level: 4 }).run(), title: `Heading 4 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}4)` },
    "sep",
    { key: "bulletList", active: isActive((e) => e.isActive("bulletList")), icon: <ListIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleBulletList().run(), title: `Bullet List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}8)` },
    { key: "orderedList", active: isActive((e) => e.isActive("orderedList")), icon: <ListOrderedIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleOrderedList().run(), title: `Numbered List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}7)` },
    { key: "taskList", active: isActive((e) => e.isActive("taskList")), icon: <CheckSquareIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleTaskList().run(), title: "Task List" },
    { key: "blockquote", active: isActive((e) => e.isActive("blockquote")), icon: <QuoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleBlockquote().run(), title: `Blockquote (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}B)` },
    { key: "inlineCode", active: isActive((e) => e.isActive("code")), icon: <InlineCodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleCode().run(), title: `Inline Code (${mod}${isMac ? "" : "+"}E)` },
    { key: "codeBlock", active: isActive((e) => e.isActive("codeBlock")), icon: <CodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => editor!.chain().focus().toggleCodeBlock().run(), title: `Code Block (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}C)` },
    { key: "blockMath", active: isActive((e) => e.isActive("blockMath")), icon: <BlockMathIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => handleAddBlockMath(), title: "Block Math" },
    { key: "hr", active: false, icon: <SeparatorIcon />, action: () => editor!.chain().focus().setHorizontalRule().run(), title: "Horizontal Rule" },
    "sep",
    { key: "link", active: isActive((e) => e.isActive("link")), icon: <LinkIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => handleLinkButton(), title: `Add Link (${mod}${isMac ? "" : "+"}K)` },
    { key: "wikilink", active: false, icon: <BracketsIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => handleAddWikilink(), title: "Insert Wikilink" },
    { key: "image", active: false, icon: <ImageIcon className="w-4.5 h-4.5 stroke-[1.5]" />, action: () => handleImageDialog(), title: "Add Image" },
  ];
    // Keep-alive for hidden format-bar (toolbarButtons, GridPicker, tableMenuOpen, ToolbarButton, DropdownMenu)
    void toolbarButtons; void GridPicker; void tableMenuOpen; void setTableMenuOpen; void ToolbarButton; void DropdownMenu;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-bg relative">
      {/* Header */}
      <div className="h-11 shrink-0 flex items-center px-3 border-b border-border">
        <div className="w-8 shrink-0" />

        <div className="flex-1 min-w-0 self-stretch flex items-center justify-center" data-tauri-drag-region>
          {currentFilePath ? (
            <div className="flex items-center gap-1">
              <Tooltip content={currentFilePath} delayDuration={300}>
                <span className="text-xs text-text-muted truncate cursor-default">
                  {currentFilePath.split(/[/\\]/).pop()}
                </span>
              </Tooltip>
              {hasExternalChange && (
                <div className="relative">
                  <button
                    onClick={() => setConflictMenuOpen(!conflictMenuOpen)}
                    className="text-2xs text-text-muted cursor-pointer hover:text-text"
                    title="File modified externally. Click for options."
                  >
                    ⚠
                  </button>
                  {conflictMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 bg-bg border border-border rounded-md shadow-lg py-1 z-50 w-48">
                      <button onClick={handleReloadExternal} className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg-muted whitespace-nowrap">Reload from disk</button>
                      <button onClick={handleSaveAsCurrent} className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg-muted whitespace-nowrap">Save as new file</button>
                      <button onClick={handleOverwriteExternal} className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 whitespace-nowrap">Overwrite external changes</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-text-muted truncate">
              Untitled.md <span className="text-text-muted/50">(Unsaved)</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-px shrink-0">
          <Tooltip content={`New File (${mod}${isMac ? "" : "+"}N)`}>
            <IconButton onClick={handleNewFile}>
              <FileIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          </Tooltip>
          <Tooltip content={`Open File (${mod}${isMac ? "" : "+"}O)`}>
            <IconButton onClick={handleOpenFile}>
              <FolderIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          </Tooltip>
          {!isMac && (
            <div className="ml-1 flex items-center gap-px border-l border-border/70 pl-1">
              <IconButton onClick={minimizeWindow} aria-label="Minimize window">
                <MinusIcon className="w-4.25 h-4.25 stroke-[1.7]" />
              </IconButton>
              <IconButton onClick={toggleMaximizeWindow} aria-label="Maximize window">
                <MaximizeIcon className="w-4 h-4 stroke-[1.55]" />
              </IconButton>
              <IconButton
                onClick={closeWindow}
                aria-label="Close window"
                className="hover:bg-red-500/15 hover:text-red-500"
              >
                <XIcon className="w-4.25 h-4.25 stroke-[1.7]" />
              </IconButton>
            </div>
          )}
        </div>
      </div>

      {/* Format Bar — hidden; all formatting available via markdown shortcuts / slash commands
      <div data-format-bar className="flex items-center gap-1 px-3 pb-2 border-b border-border overflow-x-auto scrollbar-none">
        {toolbarButtons.map((item, idx) =>
          item === "sep" ? (
            <div key={idx} className="w-px h-4.5 border-l border-border mx-2" />
          ) : (
            <ToolbarButton key={item.key} isActive={item.active} onClick={item.action} title={item.title}>
              {item.icon}
            </ToolbarButton>
          ),
        )}
        <DropdownMenu.Root open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
          <Tooltip content="Insert Table">
            <DropdownMenu.Trigger asChild>
              <ToolbarButton isActive={isActive((e) => e.isActive("table"))}>
                <TableIcon className="w-4.5 h-4.5 stroke-[1.5]" />
              </ToolbarButton>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="p-2.5 bg-bg border border-border rounded-md shadow-lg z-50"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <GridPicker
                onSelect={(rows, cols) => {
                  editor!.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
                  setTableMenuOpen(false);
                }}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      */}

      {/* Search toolbar */}
      {searchOpen && (
        <div className="absolute top-11 right-4 z-30">
          <SearchToolbar query={searchQuery} onChange={handleSearch}
            onNext={handleSearchNext} onPrevious={handleSearchPrev}
            onClose={handleCloseSearch} currentMatch={currentMatchIndex + 1}
            totalMatches={searchMatches.length} inputRef={searchInputRef} />
        </div>
      )}

      {/* Editor content area with resize handles overlay */}
      <div data-editor-content-area className="flex-1 relative overflow-hidden flex flex-row">
        <div className="flex-1 relative overflow-hidden">
          {false ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <SpinnerIcon className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : sourceMode ? (
            <textarea value={sourceContent} onChange={handleSourceChange}
              className="absolute inset-0 resize-none border-0 bg-transparent text-sm font-mono text-text pt-6 px-6 pb-16 outline-none"
              spellCheck={false} />
          ) : (
            <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden" dir={textDirection} onClick={() => editor?.chain().focus().run()}>
              <div className="mx-auto pt-4 pb-8 px-6">
                <EditorContent editor={editor} />
              </div>
            </div>
          )}
          {/* Status Bar */}
          {statusBarVisible && (
            <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-1 h-8 bg-bg border-t border-border text-2xs text-text-muted select-none">
              <span />
              <span>
                {charCount} {charCount === 1 ? "character" : "characters"} | {readingTime} min read
              </span>
            </div>
          )}
        </div>
        {!sourceMode && outlineVisible && (
          <Outline editor={editor} scrollContainer={scrollContainerRef.current} />
        )}
      </div>
    </div>
  );
}
