import { useEffect, useRef, useCallback, useState } from "react";
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
import { toast } from "sonner";
import { mod, shift, alt, isMac } from "../../lib/platform";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { Frontmatter } from "./Frontmatter";
import { BlockMathEditor } from "./BlockMathEditor";
import { LinkEditor } from "./LinkEditor";
import { SearchToolbar } from "./SearchToolbar";
import { SlashCommand } from "./SlashCommand";
import { Wikilink } from "./Wikilink";
import { WikilinkSuggestion } from "./WikilinkSuggestion";
import { EditorWidthHandles } from "./EditorWidthHandle";
import { ScratchBlockMath } from "./MathExtensions";
import { cn } from "../../lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { downloadPdf, downloadMarkdown } from "../../services/pdf";
import { IconButton, ToolbarButton, Tooltip } from "../ui";
import {
  BoldIcon, ItalicIcon, StrikethroughIcon,
  Heading1Icon, Heading2Icon, Heading3Icon, Heading4Icon,
  ListIcon, ListOrderedIcon, CheckSquareIcon, QuoteIcon,
  CodeIcon, InlineCodeIcon, BlockMathIcon, SeparatorIcon,
  LinkIcon, ImageIcon, TableIcon,
  SpinnerIcon, CircleCheckIcon, CopyIcon, ShareIcon,
  MarkdownIcon, MarkdownOffIcon, PanelLeftIcon,
  SearchIcon, DownloadIcon, BracketsIcon,
} from "../icons";

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

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

export function Editor({ onToggleSidebar, sidebarVisible, onEditorReady }: EditorProps) {
  const { currentNote, saveNote, selectedNoteId, createNote } = useNotes();
  const { textDirection } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [, setSelectionKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<Array<{ from: number; to: number }>>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const linkPopupRef = useRef<TippyInstance | null>(null);
  const blockMathPopupRef = useRef<TippyInstance | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const needsSaveRef = useRef(false);
  const loadedNoteIdRef = useRef<string | null>(null);
  const sourceTimeoutRef = useRef<number | null>(null);

  currentNoteIdRef.current = currentNote?.id ?? null;

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

  const saveImmediately = useCallback(async (_noteId: string, content: string) => {
    setIsSaving(true);
    try {
      await saveNote(content);
    } finally {
      setIsSaving(false);
    }
  }, [saveNote]);

  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (needsSaveRef.current && editorRef.current && loadedNoteIdRef.current) {
      needsSaveRef.current = false;
      const markdown = getMarkdown(editorRef.current);
      await saveImmediately(loadedNoteIdRef.current, markdown);
    }
  }, [saveImmediately, getMarkdown]);

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;
    needsSaveRef.current = true;
    saveTimeoutRef.current = window.setTimeout(async () => {
      if (currentNoteIdRef.current !== savingNoteId || !needsSaveRef.current) return;
      if (editorRef.current) {
        needsSaveRef.current = false;
        const markdown = getMarkdown(editorRef.current);
        await saveImmediately(savingNoteId, markdown);
      }
    }, 500);
  }, [saveImmediately, getMarkdown, currentNote?.id]);

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
    if (!currentNote) return;
    const ed = editorRef.current;
    if (!ed) return;
    try {
      await downloadPdf(ed, currentNote.title);
      toast.success("PDF saved");
    } catch (err) {
      toast.error("Failed to save PDF");
      console.error(err);
    }
    setCopyMenuOpen(false);
  }, [currentNote]);

  const handleDownloadMarkdown = useCallback(async () => {
    if (!currentNote || !editorRef.current) return;
    const md = getMarkdown(editorRef.current);
    try {
      await downloadMarkdown(currentNote.title, md);
      toast.success("Markdown saved");
    } catch (err) {
      toast.error("Failed to save markdown");
      console.error(err);
    }
    setCopyMenuOpen(false);
  }, [currentNote, getMarkdown]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: false }),
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
      Wikilink,
      WikilinkSuggestion,
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
    onUpdate: () => { scheduleSave(); },
    onSelectionUpdate: () => { closeLinkPopup(); },
  });

  useEffect(() => {
    editorRef.current = editor;
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor || !currentNote) return;
    loadedNoteIdRef.current = currentNote.id;
    const { from } = editor.state.selection;
    const currentContent = getMarkdown(editor);
    if (currentNote.content === currentContent) return;
    const scrollContainer = scrollContainerRef.current;
    let prevScrollTop = 0;
    if (scrollContainer) prevScrollTop = scrollContainer.scrollTop;
    editor.chain().focus().setContent(currentNote.content, { contentType: "markdown" } as any).run();
    if (scrollContainer) scrollContainer.scrollTop = prevScrollTop;
    if (loadedNoteIdRef.current === currentNote.id) {
      const maxPos = editor.state.doc.content.size;
      const restorePos = Math.min(from, Math.max(1, maxPos - 1));
      editor.chain().setTextSelection(restorePos).run();
    }
  }, [editor, currentNote?.id]);

  useEffect(() => {
    return () => { flushPendingSave(); };
  }, [flushPendingSave]);

  useEffect(() => {
    if (sourceMode && editorRef.current) {
      setSourceContent(getMarkdown(editorRef.current));
    }
  }, [sourceMode, getMarkdown, currentNote?.id]);

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

  // Listen for toggle-source-mode custom event from command palette
  useEffect(() => {
    const handler = () => toggleSourceMode();
    window.addEventListener("toggle-source-mode", handler);
    return () => window.removeEventListener("toggle-source-mode", handler);
  }, [toggleSourceMode]);

  const isActive = (check: (e: TiptapEditor) => boolean) => editor ? check(editor) : false;

  if (!currentNote) {
    // A note is selected but not yet loaded — show loading spinner
    if (selectedNoteId) {
      return (
        <div className="flex-1 flex flex-col bg-bg">
          <div className="h-10 shrink-0 flex items-end px-4 pb-1" data-tauri-drag-region />
          <div className="flex-1 flex items-center justify-center">
            <SpinnerIcon className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        </div>
      );
    }

    // No note selected: show empty state with "New Note" button
    return (
      <div className="flex-1 flex flex-col bg-bg">
        <div className="h-10 shrink-0 flex items-end px-4 pb-1" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center pb-8">
          <div className="text-center text-text-muted select-none">
            <div role="img" aria-label="Note"
              className="w-42 aspect-square mx-auto mb-1"
              style={{
                backgroundColor: "var(--color-text)",
                WebkitMaskImage: "url(/note-dark.png)",
                WebkitMaskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskImage: "url(/note-dark.png)",
                maskSize: "contain",
                maskRepeat: "no-repeat",
                maskPosition: "center",
              }}
            />
            <h1 className="text-2xl text-text font-serif mb-1 tracking-[-0.01em]">
              What's on your mind?
            </h1>
            <p className="text-sm">
              Pick up where you left off, or start something new
            </p>
            {createNote && (
              <button onClick={createNote}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium
                  bg-bg-emphasis text-text hover:bg-bg-muted border border-border transition-colors">
                New Note <span className="text-text-muted ml-1">{mod}{isMac ? "" : "+"}N</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

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

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-bg relative">
      {/* Header */}
      <div
        className={cn(
          "h-11 shrink-0 flex items-center justify-between px-3",
          !sidebarVisible && "pl-22",
        )}
        data-tauri-drag-region
      >
        <div className="titlebar-no-drag flex items-center gap-1 min-w-0">
          {onToggleSidebar && (
            <IconButton onClick={onToggleSidebar}
              title={sidebarVisible ? `Hide sidebar (${mod}${isMac ? "" : "+"}\\)` : `Show sidebar (${mod}${isMac ? "" : "+"}\\)`}
              className="shrink-0">
              <PanelLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          )}
          <span className="text-xs text-text-muted mb-px truncate">
            {formatDateTime(currentNote.modified)}
          </span>
        </div>

        <div className="titlebar-no-drag flex items-center gap-px shrink-0">
          {isSaving ? (
            <Tooltip content="Saving...">
              <div className="h-7 w-7 flex items-center justify-center">
                <SpinnerIcon className="w-4.5 h-4.5 text-text-muted/40 stroke-[1.5] animate-spin" />
              </div>
            </Tooltip>
          ) : (
            <Tooltip content="All changes saved">
              <div className="h-7 w-7 flex items-center justify-center rounded-full">
                <CircleCheckIcon className="w-4.5 h-4.5 mt-px stroke-[1.5] text-text-muted/40" />
              </div>
            </Tooltip>
          )}

          <Tooltip content={`Find in note (${mod}${isMac ? "" : "+"}F)`}>
            <IconButton onClick={openEditorSearch}>
              <SearchIcon className="w-4.25 h-4.25 stroke-[1.6]" />
            </IconButton>
          </Tooltip>

          <Tooltip content={sourceMode ? "View Formatted" : "View Markdown Source"}>
            <IconButton onClick={toggleSourceMode}>
              {sourceMode ? (
                <MarkdownOffIcon className="w-4.75 h-4.75 stroke-[1.4]" />
              ) : (
                <MarkdownIcon className="w-4.75 h-4.75 stroke-[1.4]" />
              )}
            </IconButton>
          </Tooltip>

          <DropdownMenu.Root open={copyMenuOpen} onOpenChange={setCopyMenuOpen}>
            <Tooltip content={`Export`}>
              <DropdownMenu.Trigger asChild>
                <IconButton>
                  <ShareIcon className="w-4.25 h-4.25 stroke-[1.6]" />
                </IconButton>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-35 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
                sideOffset={5} align="end"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <DropdownMenu.Item className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2" onSelect={handleCopyMarkdown}>
                  <CopyIcon className="w-4 h-4 stroke-[1.6]" />Copy Markdown
                </DropdownMenu.Item>
                <DropdownMenu.Item className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2" onSelect={handleCopyPlainText}>
                  <CopyIcon className="w-4 h-4 stroke-[1.6]" />Copy Plain Text
                </DropdownMenu.Item>
                <DropdownMenu.Item className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2" onSelect={handleCopyHtml}>
                  <CopyIcon className="w-4 h-4 stroke-[1.6]" />Copy HTML
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-border my-1" />
                <DropdownMenu.Item className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2" onSelect={handleDownloadPdf}>
                  <DownloadIcon className="w-4 h-4 stroke-[1.6]" />Print as PDF
                </DropdownMenu.Item>
                <DropdownMenu.Item className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2" onSelect={handleDownloadMarkdown}>
                  <DownloadIcon className="w-4 h-4 stroke-[1.6]" />Export Markdown
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Format Bar */}
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
      <div data-editor-content-area className="flex-1 relative overflow-hidden">
        <EditorWidthHandles containerRef={scrollContainerRef} />
        <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden" dir={textDirection}>
          {sourceMode ? (
            <textarea value={sourceContent} onChange={handleSourceChange}
              className="w-full h-full resize-none border-0 bg-transparent text-sm font-mono text-text p-6 outline-none"
              spellCheck={false} />
          ) : (
            <div className="mx-auto py-4 px-6">
              <EditorContent editor={editor} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
