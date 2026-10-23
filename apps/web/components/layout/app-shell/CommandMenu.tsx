"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CornerDownLeft, Search } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Kbd } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import { useJds } from "@/features/jobs";
import type { AppNavItem } from "./nav";

const MAX_ROLES = 6;

const padCount = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(2, "0");

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
 * Esc closes. The JD list is only fetched once the palette is opened. A card with the float
 * shadow, a pill input, counted result groups and a key-hint line.
 */
export function CommandMenu({ open, onOpenChange, items }: CommandMenuProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12%] z-50 w-[calc(100%-2rem)] max-w-[580px] -translate-x-1/2 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[.98] data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-left-1/2">
          <div className="relative isolate overflow-hidden rounded-card bg-popover text-popover-foreground shadow-float">
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
      <div className="p-3 pb-1">
        <div className="flex items-center gap-2.5 rounded-full border border-line bg-background pl-4 pr-3 shadow-ring focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-within:ring-offset-popover">
          <Search aria-hidden strokeWidth={1.8} className="h-4 w-4 flex-none text-ink-3" />
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
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink caret-ink outline-none placeholder:text-placeholder"
          />
          <Kbd>Esc</Kbd>
        </div>
      </div>

      <div id={listId} role="listbox" aria-label="Results" className="max-h-[min(360px,55vh)] overflow-y-auto px-2 pb-2">
        {entries.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-sm text-ink-3">
            {jds.isLoading ? "Loading roles…" : "Nothing matches that yet."}
          </p>
        ) : (
          GROUPS.map((group) => {
            const inGroup = entries.filter((e) => e.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={group}>
                <div aria-hidden className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-[12px] text-ink-3">
                  <span>{group}</span>
                  <span className="h-px flex-1 bg-line" />
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
                        "flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm transition-colors duration-150",
                        isActive ? "bg-surface-2 text-ink" : "text-ink-2",
                      )}
                    >
                      <entry.icon aria-hidden strokeWidth={1.6} className="h-4 w-4 flex-none" />
                      <span className="min-w-0 flex-1 truncate text-ink" title={entry.label}>
                        {entry.label}
                      </span>
                      <span className="text-[12px] text-ink-3">{entry.hint}</span>
                      {isActive ? <CornerDownLeft aria-hidden className="h-3.5 w-3.5 text-ink-3" /> : null}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
        <span aria-hidden>↑↓ Navigate · ↵ Open · Esc Close</span>
        <span className="tabular-nums" aria-live="polite">
          {entries.length} {entries.length === 1 ? "result" : "results"}
        </span>
      </div>
    </div>
  );
}
