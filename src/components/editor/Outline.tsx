import { useEffect, useState, useCallback } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { cn } from "../../lib/utils";

interface HeadingItem {
  pos: number;
  text: string;
  level: number;
  id: string;
}

interface OutlineProps {
  editor: TiptapEditor | null;
  scrollContainer: HTMLDivElement | null;
}

export function Outline({ editor, scrollContainer }: OutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  // 1. Gather headings from document node structure
  useEffect(() => {
    if (!editor) return;

    const updateHeadings = () => {
      const list: HeadingItem[] = [];
      try {
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level;
            const text = node.textContent;
            list.push({
              pos,
              text,
              level,
              id: `heading-${pos}-${text.slice(0, 10)}`,
            });
          }
        });
      } catch (err) {
        console.error("Failed to parse document outline:", err);
      }
      setHeadings(list);
    };

    // Run initially
    updateHeadings();

    // Re-gather headings on document update
    editor.on("update", updateHeadings);
    return () => {
      editor.off("update", updateHeadings);
    };
  }, [editor]);

  // 2. Scroll Spy (Scroll listener to highlight current active heading)
  useEffect(() => {
    if (!scrollContainer || !editor || headings.length === 0) {
      setActiveHeadingId(null);
      return;
    }

    const handleScroll = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      let activeId: string | null = null;

      // We walk through all headings and find the last one whose top position is near or above the viewport top
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        try {
          const domNode = editor.view.nodeDOM(heading.pos) as HTMLElement;
          if (domNode) {
            const rect = domNode.getBoundingClientRect();
            const relativeTop = rect.top - containerRect.top;
            
            // If the element's top is <= 60px (a comfortable offset threshold)
            if (relativeTop <= 60) {
              activeId = heading.id;
            } else {
              // Once we find a heading that is below the threshold, all subsequent headings are also below
              break;
            }
          }
        } catch {}
      }

      // Default to the first heading if scrolled above the first heading
      if (!activeId && headings.length > 0) {
        activeId = headings[0].id;
      }

      setActiveHeadingId(activeId);
    };

    // Listen to scroll events on the editor scroll container
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    // Initialize immediately to sync state
    handleScroll();

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [scrollContainer, editor, headings]);

  // 3. Jump to heading inside editor
  const handleHeadingClick = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.commands.focus();
      editor.commands.setTextSelection(pos);
      try {
        const domNode = editor.view.nodeDOM(pos) as HTMLElement;
        if (domNode) {
          domNode.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } catch {}
    },
    [editor],
  );

  return (
    <div className="w-56 shrink-0 h-full border-l border-border bg-bg flex flex-col select-none">

      {/* Heading List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5 scrollbar-none">
        {headings.length === 0 ? (
          <div className="text-center text-xs text-text-muted/65 py-8">暂无大纲标题</div>
        ) : (
          headings.map((h) => {
            const isActive = h.id === activeHeadingId;
            return (
              <button
                key={h.id}
                onClick={() => handleHeadingClick(h.pos)}
                className={cn(
                  "w-full text-left rounded-md py-1 px-2.5 text-xs transition-colors truncate block cursor-pointer",
                  isActive
                    ? "bg-bg-muted text-text font-medium"
                    : "text-text-muted hover:text-text hover:bg-bg-muted/50",
                )}
                style={{
                  paddingLeft: `${(h.level - 1) * 8 + 10}px`,
                }}
                title={h.text}
                type="button"
              >
                {h.text || <span className="italic opacity-40">无标题</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
