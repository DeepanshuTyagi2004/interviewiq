"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

/** One setting: label and a one-line meaning on the left, its control on the right. Rows divide with hairlines inside a card. */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[14px] text-foreground">
            {label}
          </label>
        ) : (
          <p className="m-0 text-[14px] text-foreground">{label}</p>
        )}
        {hint ? <div className="m-0 mt-0.5 text-[12.5px] leading-[1.45] text-ink-3">{hint}</div> : null}
      </div>
      {children ? <div className="flex min-w-0 flex-none sm:justify-end">{children}</div> : null}
    </div>
  );
}

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
    <SettingRow
      label={label}
      hint={hint}
      htmlFor={id}
      className="flex-row items-center justify-between gap-6 sm:gap-6"
    >
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </SettingRow>
  );
}
