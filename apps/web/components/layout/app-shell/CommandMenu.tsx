"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CornerDownLeft, Search } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { useJds } from "@/features/jobs";
import type { AppNavItem } from "./nav";

const MAX_ROLES = 6;

interface Entry {
  id: string;
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
 * Esc closes. The JD list is only fetched once the palette is opened.
 */
export function CommandMenu({ open, onOpenChange, items }: CommandMenuProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12%] z-50 w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-[12px] border border-line-2 bg-card shadow-[0_40px_80px_-20px_rgba(0,0,0,.5)] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[.98] data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-left-1/2">
          <DialogPrimitive.Title className="sr-only">Search InterviewIQ</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search screens and roles, then press Enter to open.
          </DialogPrimitive.Description>
          {/* Remounts per open, so the query and highlight always start fresh. */}
          {open ? <Palette items={items} onClose={() => onOpenChange(false)} /> : null}
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
      .map((item) => ({ id: `nav-${item.href}`, label: item.label, hint: "Go to", href: item.href, icon: item.icon }));
    const roles = (jds.data ?? [])
      .filter((jd) => !q || matches(q, jd.title, jd.companyName, jd.company, jd.role, jd.specialization ?? undefined))
      .slice(0, MAX_ROLES)
      .map((jd) => ({ id: `jd-${jd.id}`, label: `${jd.companyName} · ${jd.title}`, hint: "Roadmap", href: `/jobs/${jd.id}`, icon: Briefcase }));
    return [...screens, ...roles];
  }, [items, jds.data, query]);

  const current = Math.min(active, Math.max(entries.length - 1, 0));

  function open(entry: Entry | undefined) {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, entries.length - 1));
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
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search aria-hidden className="h-4 w-4 flex-none text-faint" />
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
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <kbd className="rounded border border-line-3 px-1.5 py-0.5 font-mono text-[10.5px] text-faint">ESC</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="m-0 max-h-[min(360px,55vh)] list-none overflow-y-auto p-2">
        {entries.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {jds.isLoading ? "Loading roles…" : "Nothing matches that yet."}
          </li>
        ) : (
          entries.map((entry, i) => (
            <li
              key={entry.id}
              id={entry.id}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => setActive(i)}
              onClick={() => open(entry)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                i === current ? "bg-panel text-foreground" : "text-muted-foreground",
              )}
            >
              <entry.icon aria-hidden strokeWidth={1.6} className="h-4 w-4 flex-none" />
              <span className="min-w-0 flex-1 truncate text-foreground">{entry.label}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{entry.hint}</span>
              {i === current ? <CornerDownLeft aria-hidden className="h-3.5 w-3.5 text-faint" /> : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
