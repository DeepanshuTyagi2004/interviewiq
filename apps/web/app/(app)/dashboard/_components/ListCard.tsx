import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Bordered card with a title row and an optional "View all →" link — the dashboard's list frame. */
export function ListCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 overflow-hidden rounded-[14px] border border-line-2">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 text-sm sm:px-5">
        <h2 className="m-0 text-sm font-normal">{title}</h2>
        {action ? (
          <Link href={action.href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            {action.label}
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Centred note for an empty list. */
export function ListEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-8">
      <p className="m-0 text-sm">{title}</p>
      <p className="m-0 max-w-sm text-[13px] leading-[1.5] text-muted-foreground">{hint}</p>
    </div>
  );
}
