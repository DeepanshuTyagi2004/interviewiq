import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ROUTES } from "@/lib/constants/shared";
import { MobileNav } from "./MobileNav";
import { HEADER_LINKS } from "./nav";

/**
 * Sticky glass header. Full nav from `lg`; below that the links, "Log in" and "Book a demo"
 * move into the menu sheet. The inline nav clips links that don't fit rather than wrapping.
 */
export function MarketingHeader() {
  return (
    <header className="iq-glass sticky top-0 z-50">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-5 px-4 sm:px-8 lg:gap-[clamp(20px,3vw,40px)]">
        <Logo href={ROUTES.home} />
        <nav
          aria-label="Main"
          className="hidden h-5 min-w-0 flex-1 flex-wrap gap-x-[clamp(14px,2vw,26px)] gap-y-5 overflow-hidden whitespace-nowrap text-[13.5px] leading-5 lg:flex"
        >
          {HEADER_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className="text-ink-2 transition-colors hover:text-foreground">
              {link.label}
              {link.menu ? (
                <span aria-hidden className="ml-1 text-xs text-faint">
                  ⌄
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-none items-center gap-2.5">
          <ThemeToggle className="hidden sm:flex" />
          <Link href={ROUTES.login} className="hidden px-2.5 py-2 text-[13.5px] text-ink-2 transition-colors hover:text-foreground md:inline-block">
            Log in
          </Link>
          <Link
            href="/#universities"
            className={cn(buttonVariants({ variant: "strong" }), "hidden h-[34px] px-[13px] text-[13.5px] lg:inline-flex")}
          >
            Book a demo
          </Link>
          <Link href={ROUTES.signup} className={cn(buttonVariants(), "h-[34px] px-3.5 text-[13.5px]")}>
            Start free
          </Link>
          <MobileNav className="lg:hidden" />
        </div>
      </div>
    </header>
  );
}
