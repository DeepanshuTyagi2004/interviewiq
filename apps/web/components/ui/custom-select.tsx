"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** A labelled, keyboard-operable single-value listbox, portalled above dialogs and the HUD. */
export function CustomSelect({ value, onValueChange, options, label, disabled, readOnly, id, name, className }: {
  value: string; onValueChange: (value: string) => void; options: readonly SelectOption[];
  label: string; disabled?: boolean; readOnly?: boolean; id?: string; name?: string; className?: string;
}) {
  const uid = useId();
  const listId = `${uid}-options`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useRef({ text: "", time: 0 });
  const list = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => option.value === value);
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  if (open && (disabled || readOnly)) setOpen(false);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled || disabled || readOnly) return;
    if (option.value !== value) onValueChange(option.value);
    setOpen(false);
  }
  function key(event: React.KeyboardEvent) {
    const index = enabled.indexOf(active);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(enabled[(index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length] ?? 0);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); setActive(enabled[event.key === "Home" ? 0 : enabled.length - 1] ?? 0);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); choose(active);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      search.current = { text: (now - search.current.time > 700 ? "" : search.current.text) + event.key.toLowerCase(), time: now };
      const found = enabled.find((i) => options[i].label.toLowerCase().startsWith(search.current.text));
      if (found !== undefined) setActive(found);
    }
  }
  return <Popover.Root open={open} onOpenChange={(next) => {
    if (disabled || readOnly) return;
    if (next) {
      search.current = { text: "", time: 0 };
      const selected = options.findIndex((option) => option.value === value && !option.disabled);
      setActive(selected >= 0 ? selected : enabled[0] ?? 0);
    }
    setOpen(next);
  }}>
    {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
    <Popover.Trigger asChild>
      <button type="button" id={id} role="combobox" aria-label={label} aria-haspopup="listbox" aria-controls={listId}
        aria-expanded={open} aria-readonly={readOnly || undefined} disabled={disabled}
        onKeyDown={(event) => {
          if (!disabled && !readOnly && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            search.current = { text: "", time: 0 };
            const selected = options.findIndex((option) => option.value === value && !option.disabled);
            setActive(selected >= 0 ? selected : enabled[event.key === "ArrowDown" ? 0 : enabled.length - 1] ?? 0);
            setOpen(true);
          }
        }}
        className={cn("flex h-10 w-full items-center justify-between gap-2 rounded-full bg-background px-4 text-left text-[13px] text-foreground shadow-ring outline-none transition-colors duration-150 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50", className)}>
        <span className="min-w-0 truncate">{chosen?.label ?? value}</span><ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={5} className="z-[80] min-w-[var(--radix-popover-trigger-width)] rounded-tile iq-glass-thick p-1.5 text-foreground shadow-float"
      onOpenAutoFocus={(event) => { event.preventDefault(); list.current?.focus(); }}>
      <div ref={list} id={listId} role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={`${uid}-${active}`}
        onKeyDown={key} className="max-h-[min(320px,var(--radix-popover-content-available-height))] overflow-y-auto outline-none">
        {options.map((option, index) => <div key={option.value} id={`${uid}-${index}`} data-option-index={index} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}
          className={cn("flex cursor-default items-center justify-between gap-3 rounded-full px-3 py-2 text-[13px]", active === index && "bg-surface-2", option.disabled && "opacity-40")}>
          {option.label}{option.value === value ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}
        </div>)}
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
