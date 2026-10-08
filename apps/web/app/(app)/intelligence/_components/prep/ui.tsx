"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/features/research";
import { cn } from "@/lib/utils/cn";

/** Small building blocks shared by the Interview prep diagnostics views. */

export const FIELD =
  "h-8 rounded-full border border-line-4 bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export const PRE =
  "m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line-2 bg-panel p-3 font-mono text-[12px] leading-[1.5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** A titled block with a mono eyebrow heading. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="iq-eyebrow m-0">{title}</h4>
        {action ? <div className="ml-auto flex items-center gap-1.5">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A bullet list, or a quiet dash when empty. */
export function Lines({ items, mono = false }: { items: readonly string[] | undefined; mono?: boolean }) {
  if (!items?.length) return <p className="m-0 text-xs text-faint">—</p>;
  return (
    <ul className={cn("m-0 list-disc space-y-1 pl-5 text-[13px] leading-[1.5]", mono && "font-mono text-[12px]")}>
      {items.map((x, i) => (
        <li key={i} className="[overflow-wrap:anywhere]">{x}</li>
      ))}
    </ul>
  );
}

/** Label / value pairs as a compact definition list. */
export function Facts({ items, className }: { items: ReadonlyArray<[string, React.ReactNode]>; className?: string }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]", className)}>
      {items.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="font-mono text-[11px] uppercase leading-5 tracking-[0.06em] text-faint">{label}</dt>
          <dd className="m-0 min-w-0 leading-5 [overflow-wrap:anywhere]">{value ?? "—"}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A ghost pill button that copies text to the clipboard (with a toast). */
export function CopyButton({ text, what, label = "Copy", className }: { text: string; what: string; label?: string; className?: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" className={cn("h-7 px-2.5 text-[12px]", className)} onClick={() => void copyText(text, what)}>
      <Copy aria-hidden />
      {label}
    </Button>
  );
}

/** Scrollable mono text with an optional copy button above it. */
export function MonoBlock({ text, label, copy = true }: { text: string; label: string; copy?: boolean }) {
  return (
    <div className="space-y-1.5">
      {copy ? (
        <div className="flex justify-end">
          <CopyButton text={text} what={`${label} copied`} label={`Copy ${label.toLowerCase()}`} />
        </div>
      ) : null}
      <pre tabIndex={0} role="region" aria-label={label} className={PRE}>
        {text}
      </pre>
    </div>
  );
}

/** Native disclosure (keyboard and screen-reader friendly) with the console's look. */
export function Collapsible({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group rounded-[12px] border border-line-2 px-3 py-2", className)}>
      <summary className="cursor-pointer select-none rounded-sm text-[13px] text-muted-foreground marker:text-faint hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {summary}
      </summary>
      <div className="mt-2 space-y-3">{children}</div>
    </details>
  );
}

/** A failure line: code, message and (optionally) the stage it happened in. */
export function ErrorBox({ code, message, stage }: { code: string; message: string; stage?: string | null }) {
  return (
    <div role="alert" className="rounded-[12px] border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px]">
      <p className="m-0 font-mono text-[12px] text-destructive">
        {code}
        {stage ? <span className="text-muted-foreground"> · at {stage}</span> : null}
      </p>
      <p className="m-0 mt-1 font-mono text-[12px] leading-[1.5] text-foreground [overflow-wrap:anywhere]">{message}</p>
    </div>
  );
}

/** ✓ / ✗ with words, so colour is never the only signal. */
export function PassMark({ ok, yes = "valid", no = "invalid" }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[11.5px]", ok ? "text-foreground" : "text-destructive")}>
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      {ok ? yes : no}
    </span>
  );
}
