"use client";

import { forwardRef, useId, useLayoutEffect, useRef, useState } from "react";
import { Bold, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, type LucideIcon } from "lucide-react";
import { FormattedLines } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import {
  continueList,
  isOnListLine,
  shiftIndent,
  toggleList,
  toggleWrap,
  type TextEdit,
} from "../highlights-format";

export interface HighlightsEditorProps {
  id?: string;
  /** One line per entry, in the resume's Markdown format (see highlights-format.ts). */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  "aria-describedby"?: string;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

/**
 * Highlights field with light formatting: Bold / Italic, bullet and numbered lists, nesting, and a
 * live Preview. Stores plain Markdown lines — the same format the resume parser returns.
 *
 * Keyboard: ⌘/Ctrl+B bold, ⌘/Ctrl+I italic, Enter continues a list (Enter on an empty item ends it),
 * Tab / Shift+Tab nest / un-nest — only on list lines, so Tab still moves focus elsewhere.
 */
export const HighlightsEditor = forwardRef<HTMLTextAreaElement, HighlightsEditorProps>(function HighlightsEditor(
  { id, value, onChange, onBlur, placeholder, "aria-describedby": describedBy },
  forwardedRef,
) {
  const fallbackId = useId();
  const textareaId = id ?? fallbackId;
  const [mode, setMode] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Selection to restore after React re-renders the controlled value.
  const pendingSelection = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Grow with the content (the CSS max-height caps it, then it scrolls).
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
    const sel = pendingSelection.current;
    if (sel) {
      el.setSelectionRange(sel[0], sel[1]);
      pendingSelection.current = null;
    }
  }, [value, mode]);

  function apply(edit: (v: string, s: number, e: number) => TextEdit | null) {
    const el = ref.current;
    if (!el) return;
    const result = edit(el.value, el.selectionStart, el.selectionEnd);
    if (!result) return;
    pendingSelection.current = [result.start, result.end];
    onChange(result.value);
    el.focus();
  }

  const actions: { label: string; icon: LucideIcon; shortcut?: string; run: () => void }[] = [
    { label: "Bold", icon: Bold, shortcut: `${MOD}B`, run: () => apply((v, s, e) => toggleWrap(v, s, e, "**")) },
    { label: "Italic", icon: Italic, shortcut: `${MOD}I`, run: () => apply((v, s, e) => toggleWrap(v, s, e, "*")) },
    { label: "Bulleted list", icon: List, run: () => apply((v, s, e) => toggleList(v, s, e, "bullet")) },
    { label: "Numbered list", icon: ListOrdered, run: () => apply((v, s, e) => toggleList(v, s, e, "number")) },
    { label: "Decrease indent", icon: IndentDecrease, shortcut: "Shift+Tab", run: () => apply((v, s, e) => shiftIndent(v, s, e, -1)) },
    { label: "Increase indent", icon: IndentIncrease, shortcut: "Tab", run: () => apply((v, s, e) => shiftIndent(v, s, e, 1)) },
  ];

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      actions[0].run();
    } else if (mod && !e.shiftKey && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      actions[1].run();
    } else if (e.key === "Enter" && !mod && !e.shiftKey && !e.nativeEvent.isComposing) {
      const el = e.currentTarget;
      if (el.selectionStart === el.selectionEnd && isOnListLine(el.value, el.selectionStart)) {
        e.preventDefault();
        apply((v, s) => continueList(v, s));
      }
    } else if (e.key === "Tab" && !mod) {
      const el = e.currentTarget;
      if (isOnListLine(el.value, el.selectionStart)) {
        e.preventDefault();
        apply((v, s, en) => shiftIndent(v, s, en, e.shiftKey ? -1 : 1));
      }
    }
  }


  return (
    <div className="overflow-hidden rounded-md border border-input bg-card transition-colors focus-within:border-faint focus-within:ring-[3px] focus-within:ring-foreground/10">
      <div className="flex items-center gap-0.5 border-b border-line bg-panel/60 px-1.5 py-1">
        <div role="toolbar" aria-label="Formatting" aria-controls={textareaId} className="flex flex-wrap items-center gap-0.5">
          {actions.map((a, i) => (
            <span key={a.label} className="contents">
              {i === 2 || i === 4 ? <span aria-hidden className="mx-1 h-4 w-px bg-line-3" /> : null}
              <button
                type="button"
                onClick={a.run}
                disabled={mode === "preview"}
                aria-label={a.shortcut ? `${a.label} (${a.shortcut})` : a.label}
                title={a.shortcut ? `${a.label} · ${a.shortcut}` : a.label}
                // Keep the textarea's selection when clicking a toolbar button.
                onMouseDown={(e) => e.preventDefault()}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
              >
                <a.icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
        <div role="group" aria-label="Editor view" className="ml-auto flex rounded-[5px] p-0.5">
          {(["write", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-2 py-1 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                mode === m ? "bg-card text-foreground shadow-hairline" : "text-faint hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "write" ? (
        <textarea
          ref={(el) => {
            ref.current = el;
            if (typeof forwardedRef === "function") forwardedRef(el);
            else if (forwardedRef) forwardedRef.current = el;
          }}
          id={textareaId}
          value={value}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-describedby={describedBy}
          spellCheck
          className="block max-h-[22rem] w-full resize-none overflow-y-auto bg-transparent px-3 py-2 font-mono text-[13px] leading-[1.6] text-foreground outline-none placeholder:font-sans placeholder:text-faint"
        />
      ) : (
        <div className="min-h-[96px] px-3 py-2.5" aria-live="polite">
          {value.trim() ? (
            <FormattedLines lines={value.split("\n")} />
          ) : (
            <p className="m-0 text-[13px] text-faint">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
});
