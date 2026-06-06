import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

export default function MarketingHomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:py-32">
      <span className="mb-5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
        AI-powered mock interviews
      </span>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
        Practice interviews that feel real.
      </h1>
      <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
        Unlimited, role-specific, voice-based mock interviews with a personalized
        AI interviewer — built for your next placement.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Link
          href={ROUTES.login}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Get started
        </Link>
        <Link
          href={ROUTES.pricing}
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          View pricing
        </Link>
      </div>
    </main>
  );
}
