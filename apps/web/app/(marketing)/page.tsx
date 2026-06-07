import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

const VALUE_PROPS = [
  {
    title: "Voice-driven mock interviews",
    body: "A personalized AI interviewer conducts role- and company-specific loops, end to end.",
  },
  {
    title: "Full candidate context",
    body: "Connect GitHub, your résumé and coding profiles so every question fits who you are.",
  },
  {
    title: "Structured feedback",
    body: "Get a descriptive debrief after each session — what you showed, in your own data.",
  },
];

export default function MarketingHomePage() {
  return (
    <main className="relative">
      {/* Subtle dot-grid background, monochrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.4] [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]"
      />

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:py-32">
        <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          AI-powered mock interviews
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
          Practice interviews that feel real.
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
          Unlimited, role-specific, voice-based mock interviews with a
          personalized AI interviewer — built for your next placement.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            href={ROUTES.login}
            className="rounded-md border border-border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href={ROUTES.pricing}
            className="rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            View pricing
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:pb-32">
        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          {VALUE_PROPS.map((vp) => (
            <div key={vp.title} className="bg-card p-6">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {vp.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{vp.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
