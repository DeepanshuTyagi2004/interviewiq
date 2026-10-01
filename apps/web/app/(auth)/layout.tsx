import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ROUTES } from "@/lib/constants/shared";

/** Auth shell from the design: frame header (logo, theme, back to site) over a rounded card. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-frame">
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
      <main className="mx-2 mb-2 flex flex-1 flex-col overflow-hidden rounded-[14px] border border-line-3 bg-card sm:mx-3 sm:mb-3">
        {children}
      </main>
    </div>
  );
}
