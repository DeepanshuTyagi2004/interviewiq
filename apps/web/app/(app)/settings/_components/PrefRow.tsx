"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";

/** One on/off setting: label, a one-line meaning, and the switch, as a row inside a card. */
export function PrefRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[14px] text-foreground">
          {label}
        </label>
        {hint ? <p className="m-0 mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
