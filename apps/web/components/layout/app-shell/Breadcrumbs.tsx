"use client";

import { createContext, Fragment, useContext, useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { breadcrumbsForPath, type BreadcrumbNames } from "./breadcrumbs";

type SetNames = (patch: BreadcrumbNames | null) => void;

/** Lets a page tell the top bar the names it knows (company, role, track, process). */
export const BreadcrumbNamesContext = createContext<SetNames | null>(null);

/**
 * Call from a page that knows a name: `useBreadcrumbNames({ company, companySlug, role })`.
 * Undefined values are ignored, and the names are cleared when the page unmounts.
 */
export function useBreadcrumbNames(names: BreadcrumbNames): void {
  const set = useContext(BreadcrumbNamesContext);
  const { company, companySlug, role, track, process } = names;
  useEffect(() => {
    if (!set) return;
    set({ company, companySlug, role, track, process });
    return () => set(null);
  }, [set, company, companySlug, role, track, process]);
}

const link =
  "rounded-md text-ink-2 outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The top bar's trail: parents are links that never truncate, the current screen is ink and is the
 * only crumb that truncates. Below 640px only the current screen shows; below 1280px the middle
 * crumbs of a long trail collapse to "…".
 */
export function Breadcrumbs({ pathname, names }: { pathname: string; names: BreadcrumbNames }) {
  const crumbs = breadcrumbsForPath(pathname, names);
  const long = crumbs.length > 2;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-[14px]">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          const middle = long && i > 0 && !last;
          const sep = (
            <li aria-hidden className={cn("hidden flex-none text-ink-3", middle ? "xl:block" : "sm:block")}>
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            </li>
          );
          return (
            <Fragment key={`${i}-${crumb.label}`}>
              {i > 0 ? sep : null}
              {middle && i === 1 ? (
                <>
                  <li aria-hidden className="hidden flex-none text-ink-3 sm:block xl:hidden">
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </li>
                  <li aria-hidden className="hidden flex-none text-ink-3 sm:block xl:hidden">…</li>
                </>
              ) : null}
              <li
                className={cn(
                  last
                    ? "min-w-0 font-medium text-ink"
                    : cn("hidden flex-none whitespace-nowrap text-ink-2", middle ? "xl:block" : "sm:block"),
                )}
              >
                {crumb.href && !last ? (
                  <Link href={crumb.href} className={cn(link, "block whitespace-nowrap")} title={crumb.label}>
                    {crumb.label}
                  </Link>
                ) : last ? (
                  <span aria-current="page" className="block truncate" title={crumb.label}>
                    {crumb.label}
                  </span>
                ) : (
                  <span className="block whitespace-nowrap" title={crumb.label}>
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
