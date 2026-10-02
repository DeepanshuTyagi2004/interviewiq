"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CornerDownLeft } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Kbd, padCount } from "@/components/hud";
import { cn } from "@/lib/utils/cn";
import { useJds } from "@/features/jobs";
import type { AppNavItem } from "./nav";

const MAX_ROLES = 6;

type Group = "Screens" | "Roles";
const GROUPS: Group[] = ["Screens", "Roles"];

interface Entry {
  id: string;
  group: Group;
  label: string;
  hint: string;
  href: string;
  icon: AppNavItem["icon"];
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  return fields.some((f) => f?.toLowerCase().includes(query));
}

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AppNavItem[];
}

/**
 * ⌘K palette: jump to any screen or straight to a role's roadmap. Arrow keys move, Enter opens,
 * Esc closes. The JD list is only fetched once the palette is opened. Styled as a HUD console:
 * notched frame, a `QUERY ›` prompt, counted result groups and a key-hint readout.
 */
export function CommandMenu({ open, onOpenChange, items }: CommandMenuProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        {/* The shadow is a drop-shadow on the wrapper so it follows the notched outline (a
            box-shadow would be clipped away with the corner). */}
        <DialogPrimitive.Content className="fixed left-1/2 top-[12%] z-50 w-[calc(100%-2rem)] max-w-[580px] -translate-x-1/2 drop-shadow-[0_30px_40px_rgba(0,0,0,.28)] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[.98] data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-left-1/2">
          <div className="hud-card hud-notch relative isolate overflow-hidden rounded-[16px] border border-line-2 bg-card">
            <span aria-hidden className="hud-ticks" data-notch="" />
            <span aria-hidden className="hud-notch-line" />
            <DialogPrimitive.Title className="sr-only">Search InterviewIQ</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Search screens and roles, then press Enter to open.
            </DialogPrimitive.Description>
            {/* Remounts per open, so the query and highlight always start fresh. */}
            {open ? <Palette items={items} onClose={() => onOpenChange(false)} /> : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

function Palette({ items, onClose }: { items: AppNavItem[]; onClose: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const jds = useJds({}, { enabled: true });

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    const screens = items
      .filter((item) => !q || matches(q, item.label, ...(item.keywords ?? [])))
      .map((item) => ({
        id: `nav-${item.href}`,
        group: "Screens" as const,
        label: item.label,
        hint: "Go to",
        href: item.href,
        icon: item.icon,
      }));
    const roles = (jds.data ?? [])
      .filter((jd) => !q || matches(q, jd.title, jd.companyName, jd.company, jd.role, jd.specialization ?? undefined))
      .slice(0, MAX_ROLES)
      .map((jd) => ({
        id: `jd-${jd.id}`,
        group: "Roles" as const,
        label: `${jd.companyName} · ${jd.title}`,
        hint: "Roadmap",
        href: `/jobs/${jd.id}`,
        icon: Briefcase,
      }));
    return [...screens, ...roles];
  }, [items, jds.data, query]);

  const current = Math.max(0, Math.min(active, entries.length - 1));
  const currentId = entries[current]?.id;

  // Arrow keys move the highlight; keep it scrolled into the capped list.
  useEffect(() => {
    if (currentId) document.getElementById(currentId)?.scrollIntoView?.({ block: "nearest" });
  }, [currentId]);

  function open(entry: Entry | undefined) {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(i + 1, entries.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(entries[current]);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <span aria-hidden className="flex-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
          Query <span className="text-brand">›</span>
        </span>
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={entries[current]?.id}
          aria-label="Search companies, roles and screens"
          placeholder="Search companies, roles, screens"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] caret-brand outline-none placeholder:text-faint"
        />
        <Kbd size="sm">Esc</Kbd>
      </div>

      <div id={listId} role="listbox" aria-label="Results" className="max-h-[min(360px,calc(55vh/var(--hud-zoom,1)))] overflow-y-auto px-2 pb-2">
        {entries.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground">
            {jds.isLoading ? "Loading roles…" : "Nothing matches that yet."}
          </p>
        ) : (
          GROUPS.map((group) => {
            const inGroup = entries.filter((e) => e.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={group}>
                <div
                  aria-hidden
                  className="flex items-center gap-2 px-3 pb-1.5 pt-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint"
                >
                  <span>{group}</span>
                  <span className="h-px flex-1 bg-line-2" />
                  <span className="tabular-nums">{padCount(inGroup.length)}</span>
                </div>
                {inGroup.map((entry) => {
                  const i = entries.indexOf(entry);
                  const isActive = i === current;
                  return (
                    <div
                      key={entry.id}
                      id={entry.id}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => setActive(i)}
                      onClick={() => open(entry)}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                        isActive
                          ? "bg-panel text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-brand"
                          : "text-muted-foreground",
                      )}
                    >
                      <entry.icon aria-hidden strokeWidth={1.6} className="h-4 w-4 flex-none" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{entry.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{entry.hint}</span>
                      {isActive ? <CornerDownLeft aria-hidden className="h-3.5 w-3.5 text-faint" /> : null}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
        <span aria-hidden>↑↓ Navigate · ↵ Open · Esc Close</span>
        <span className="tabular-nums" aria-live="polite">
          {entries.length} {entries.length === 1 ? "result" : "results"}
        </span>
      </div>
    </div>
  );
}
