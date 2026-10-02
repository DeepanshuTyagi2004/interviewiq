import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Renders resume highlight lines written in a small Markdown subset — the format the parser
 * returns and the Highlights editor produces:
 *
 *   **Sub-heading**            plain line → paragraph (bold where marked)
 *   - A bullet with **bold**   "- " or "* " → bullet
 *     - A nested bullet        two spaces per level → nested list
 *   1. A numbered point        "1. " / "1) " → numbered list
 *
 * Inline: **bold** and *italic* / _italic_. Everything renders as React text nodes — no HTML is
 * ever interpreted, so pasted content can't inject markup.
 *
 * Lines with no list markers at all (the older "one point per line" format) render as a bullet
 * list, so highlights saved before Markdown support keep looking like bullets.
 */

const LIST_LINE = /^(\s*)([-*]|\d+[.)])\s+(.*)$/; // [, indent, marker, text]
const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_)/g;

type Item = { text: string; children: ListBlock[] };
type ListBlock = { kind: "list"; ordered: boolean; items: Item[] };
type Block = { kind: "p"; text: string } | ListBlock;

/** Group lines into paragraphs and (nested) lists. Exported for tests. */
export function parseLines(lines: string[]): Block[] {
  const filled = lines.filter((l) => l.trim());
  if (filled.length > 0 && !filled.some((l) => LIST_LINE.test(l))) {
    return [{ kind: "list", ordered: false, items: filled.map((l) => ({ text: l.trim(), children: [] })) }];
  }
  const blocks: Block[] = [];
  // Stack of open lists by depth; stack[0] is the top-level list.
  let stack: ListBlock[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = LIST_LINE.exec(raw);
    if (!m) {
      stack = [];
      blocks.push({ kind: "p", text: raw.trim() });
      continue;
    }
    const [, indent, marker, text] = m;
    const ordered = /\d/.test(marker);
    const depth = Math.min(Math.floor(indent.replace(/\t/g, "  ").length / 2), stack.length);
    const item: Item = { text, children: [] };

    if (depth === 0) {
      const top = stack[0];
      if (top && top.ordered === ordered) {
        top.items.push(item);
        stack = [top];
      } else {
        const list: ListBlock = { kind: "list", ordered, items: [item] };
        blocks.push(list);
        stack = [list];
      }
      continue;
    }

    // Nested: attach to the last item of the list one level up.
    stack = stack.slice(0, depth + 1);
    const parentList = stack[depth - 1];
    const parentItem = parentList.items[parentList.items.length - 1];
    const existing = stack[depth];
    if (existing && existing.ordered === ordered && parentItem.children.includes(existing)) {
      existing.items.push(item);
    } else {
      const list: ListBlock = { kind: "list", ordered, items: [item] };
      parentItem.children.push(list);
      stack[depth] = list;
    }
  }
  return blocks;
}

/** **bold**, *italic* / _italic_ → React nodes. */
export function renderInline(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      if (part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function ListView({ block, depth }: { block: ListBlock; depth: number }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "m-0 space-y-1 pl-5",
        block.ordered ? "list-decimal" : depth === 0 ? "list-disc" : "list-[circle]",
        "marker:text-faint",
      )}
    >
      {block.items.map((item, i) => (
        <li key={i} className="pl-0.5">
          {renderInline(item.text)}
          {item.children.map((child, j) => (
            <ListView key={j} block={child} depth={depth + 1} />
          ))}
        </li>
      ))}
    </Tag>
  );
}

export interface FormattedLinesProps {
  lines: string[];
  className?: string;
}

/** Formatted highlight lines (see module comment). Renders nothing for an empty list. */
export function FormattedLines({ lines, className }: FormattedLinesProps) {
  const blocks = parseLines(lines);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("space-y-1.5 text-[13.5px] leading-[1.55] text-muted-foreground", className)}>
      {blocks.map((block, i) =>
        block.kind === "p" ? (
          <p key={i} className="m-0 text-foreground">
            {renderInline(block.text)}
          </p>
        ) : (
          <ListView key={i} block={block} depth={0} />
        ),
      )}
    </div>
  );
}
