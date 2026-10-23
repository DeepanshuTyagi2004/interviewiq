import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, Count, Kbd, PageHeader } from "@/components/ds";
import { ROUTES } from "@/lib/constants/shared";
import { FAQS } from "@/app/(marketing)/_components/landing/content";
import { FaqList } from "./_components/FaqList";

const FAQ_ITEMS = FAQS.map(([question, answer]) => ({ question, answer }));

/** The shell's real shortcuts (see AppShell): M collapses or expands the menu, ⌘K / Ctrl+K search, Esc closes. */
const SHORTCUTS: { action: string; hint?: string; keys: React.ReactNode }[] = [
  {
    action: "Collapse or expand the menu",
    hint: "When you’re not typing in a field",
    keys: <Kbd>M</Kbd>,
  },
  {
    action: "Search companies, roles and pages",
    keys: (
      <>
        <Kbd>⌘K</Kbd>
        <span className="text-xs text-ink-3">or</span>
        <Kbd>Ctrl K</Kbd>
      </>
    ),
  },
  {
    action: "Close the menu or search",
    keys: <Kbd>Esc</Kbd>,
  },
];

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Help"
        title="How can we help?"
        description="Answers to common questions, and the shortcuts that get you around faster."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Frequently asked questions" flush>
          <FaqList items={FAQ_ITEMS} />
        </Card>

        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-[60px]">
          <Card
            title="Keyboard shortcuts"
            meta={<Count n={SHORTCUTS.length} label={`${SHORTCUTS.length} shortcuts`} />}
            flush
          >
            <ul className="m-0 mt-2 list-none p-0">
              {SHORTCUTS.map((s) => (
                <li
                  key={s.action}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-3.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm">{s.action}</span>
                    {s.hint ? <span className="block text-xs text-ink-3">{s.hint}</span> : null}
                  </span>
                  <span className="ml-auto flex flex-none items-center gap-1.5">{s.keys}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card tone="surface" title="Still stuck?">
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm leading-[1.55] text-ink-2">
                Can’t find what you need? Tell us what happened and we’ll help you sort it out.
              </p>
              <Link
                href={ROUTES.contact}
                className="inline-flex items-center gap-1.5 self-start rounded-md text-sm underline underline-offset-4 outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Contact us
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
