import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <Link href={ROUTES.home} className="font-semibold tracking-tight text-foreground">
            InterviewIQ
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href={ROUTES.pricing}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href={ROUTES.forColleges}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              For colleges
            </Link>
            <Link
              href={ROUTES.login}
              className="ml-2 rounded-md bg-primary px-3.5 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
