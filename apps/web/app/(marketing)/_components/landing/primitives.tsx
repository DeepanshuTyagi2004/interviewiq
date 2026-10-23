import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { buttonVariants } from "@/components/ui/button";
import type { ListItem } from "./content";

/** Page-width container shared by every landing section. */
export const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-6";

/** Small uppercase section label. */
export function Eyebrow({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn("iq-eyebrow m-0", className)}>
      {children}
    </p>
  );
}

/** Icon-led bullet list under a section's copy; the lead phrase is underlined like the design. */
export function FeatureList({ items }: { items: ListItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((item) => (
        <li key={item.b} className="flex gap-3 text-[15px] leading-[1.45] text-muted-foreground">
          <span aria-hidden className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-2 text-xs text-foreground">
            {item.icon}
          </span>
          <span>
            <span className="font-medium text-foreground">{item.b}</span> {item.t}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The design's ink-bordered outline link ("Explore company research"). */
export function OutlineLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: "strong" }), "h-10 self-start px-5 text-sm", className)}
    >
      {children}
    </Link>
  );
}
