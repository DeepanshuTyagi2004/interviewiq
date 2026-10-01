import Link from "next/link";
import { FOOTER_COLUMNS } from "./nav";

/** Frame-coloured footer: the oversized three-bar mark, legal links and four link columns. */
export function MarketingFooter() {
  return (
    <footer className="bg-frame">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-14 px-6 pb-12 pt-16 sm:pt-20 lg:flex-row">
        <div className="flex flex-col gap-10 lg:flex-[1_1_280px]">
          <span aria-hidden className="flex h-[110px] items-end gap-2.5 sm:h-[150px] sm:gap-3.5">
            <span className="h-full w-[30px] bg-foreground sm:w-10" />
            <span className="h-2/3 w-[30px] bg-foreground sm:w-10" />
            <span className="h-1/3 w-[30px] bg-brand sm:w-10" />
          </span>
          <div className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground">
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
            <div key={col.title} className="flex flex-col gap-[9px] text-[13px]">
              <h2 className="m-0 mb-1 text-[13px] font-medium">{col.title}</h2>
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
