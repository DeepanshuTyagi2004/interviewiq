/** Shared select trigger styling (same height, hairline, focus = ink border). */
export const SELECT_CLASS =
  "h-9 w-full rounded-full border border-input bg-card px-3 text-sm text-foreground transition-colors focus-visible:border-faint focus-visible:ring-[3px] focus-visible:ring-foreground/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Native <textarea> dressed like the shared Textarea, without its tall minimum height. */
export const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors placeholder:text-faint focus-visible:border-faint focus-visible:ring-[3px] focus-visible:ring-foreground/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";
