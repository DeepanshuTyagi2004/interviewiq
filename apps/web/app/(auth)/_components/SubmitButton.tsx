import { cn } from "@/lib/utils/cn";

/** Full-width brand submit with an inline spinner while pending. */
export function SubmitButton({ pending, children, pendingLabel }: { pending: boolean; children: React.ReactNode; pendingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "flex h-[46px] w-full items-center justify-center gap-2.5 rounded-full bg-brand text-[14.5px] text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-progress disabled:opacity-80",
      )}
    >
      {pending ? pendingLabel : children}
      {pending ? (
        <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-foreground border-r-transparent" />
      ) : null}
    </button>
  );
}
