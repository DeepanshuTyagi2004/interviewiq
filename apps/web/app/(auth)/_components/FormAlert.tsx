import { cn } from "@/lib/utils/cn";

/** Inline form-level message: errors in the destructive tone, confirmations on the panel. */
export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "m-0 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] leading-[1.45]",
        tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-line-2 bg-panel text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("mt-[6px] h-1.5 w-1.5 flex-none rounded-full", tone === "error" ? "bg-destructive" : "bg-brand")}
      />
      <span>{children}</span>
    </p>
  );
}
