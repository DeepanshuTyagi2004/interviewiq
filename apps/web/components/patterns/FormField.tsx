import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Label + control slot + hint/error. Pairs with react-hook-form + zod. When an
 * error is present it replaces the hint and is styled destructive.
 */
export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
