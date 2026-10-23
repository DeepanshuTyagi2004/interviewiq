import Link from "next/link";
import { FOOTER_COLUMNS } from "./nav";

/** Quiet grey footer: the three-bar mark, legal links and four link columns. */
export function MarketingFooter() {
  return (
    <footer className="mt-24 bg-surface sm:mt-[120px]">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-12 px-6 pb-12 pt-14 sm:pt-16 lg:flex-row">
        <div className="flex flex-col gap-10 lg:flex-[1_1_280px]">
          <span aria-hidden className="flex h-12 items-end gap-1.5">
            <span className="h-full w-3.5 rounded-[3px] bg-foreground" />
            <span className="h-2/3 w-3.5 rounded-[3px] bg-foreground" />
            <span className="h-1/3 w-3.5 rounded-[3px] bg-foreground/40" />
          </span>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <span className="text-foreground">InterviewIQ © 2026</span>
            <a href="#" className="w-fit text-muted-foreground hover:text-foreground">
              Privacy Policy
            </a>
            <a href="#" className="w-fit text-muted-foreground hover:text-foreground">
              Terms
            </a>
          </div>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-9 lg:flex-[2.4_1_560px]"
        >
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-[9px] text-[13.5px]">
              <h2 className="m-0 mb-1 text-[13.5px] font-semibold">{col.title}</h2>
              {col.links.map((link) => (
                <Link key={link.label} href={link.href} className="w-fit text-muted-foreground hover:text-foreground">
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
