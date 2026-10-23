import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ROUTES } from "@/lib/constants/shared";

/**
 * Auth shell: a header (logo, theme, back to site) over a floating white sheet on a soft canvas that
 * fills the rest of the viewport. The page never scrolls; content scrolls inside the card.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden">
      <div aria-hidden className="iq-app-wash" />
      <header className="flex h-[68px] flex-none items-center gap-5 px-4 sm:px-8">
        <Logo href={ROUTES.home} />
        <div className="ml-auto flex items-center gap-3.5">
          <ThemeToggle />
          <Link href={ROUTES.home} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            <span className="hidden min-[400px]:inline">Back to site</span>
            <span className="min-[400px]:hidden">Site</span>
          </Link>
        </div>
      </header>
      <main className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden iq-glass-card rounded-hero sm:mx-4 sm:mb-4">
        {children}
      </main>
    </div>
  );
}
