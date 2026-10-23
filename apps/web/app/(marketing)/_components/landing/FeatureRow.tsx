import { cn } from "@/lib/utils/cn";
import type { ListItem } from "./content";
import { CONTAINER, Eyebrow, FeatureList, OutlineLink } from "./primitives";

export interface FeatureRowProps {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  items: ListItem[];
  cta: { label: string; href: string };
  /** Illustration rendered on the grey panel. */
  panel: React.ReactNode;
  /** Put the panel on the right on wide screens. On narrow screens the panel always leads. */
  panelRight?: boolean;
  className?: string;
}

/**
 * Two-up feature section: an illustration stage beside the copy column. Stacks (panel first)
 * below `lg`; side by side above it, with the list pinned to the bottom of the copy column.
 */
export function FeatureRow({
  id,
  eyebrow,
  title,
  body,
  items,
  cta,
  panel,
  panelRight = false,
  className,
}: FeatureRowProps) {
  return (
    <section id={id} className={cn(CONTAINER, "flex scroll-mt-16 flex-col gap-10 lg:flex-row lg:gap-14", className)}>
      <div
        data-reveal
        className={cn(
          "iq-stage flex min-h-[420px] min-w-0 items-center justify-center px-5 py-10 sm:min-h-[540px] sm:px-9 sm:py-12 lg:flex-[1_1_440px]",
          panelRight && "lg:order-2",
        )}
      >
        {panel}
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:flex-[1_1_380px] lg:py-6">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 data-reveal className="iq-h2 max-w-[480px]">
          {title}
        </h2>
        <p className="m-0 max-w-[460px] text-[17px] leading-[1.5] text-muted-foreground">{body}</p>
        <div className="mt-auto flex flex-col gap-3 pt-6 lg:pt-10">
          <FeatureList items={items} />
          <OutlineLink href={cta.href} className="mt-3.5">
            {cta.label}
          </OutlineLink>
        </div>
      </div>
    </section>
  );
}
