import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/patterns";
import { ROUTES } from "@/lib/constants/shared";
import { FAQS } from "@/app/(marketing)/_components/landing/content";
import { FaqList } from "./_components/FaqList";
import { HelpCard, Kbd } from "./_components/HelpCard";

const FAQ_ITEMS = FAQS.map(([question, answer]) => ({ question, answer }));

/** The shell's real shortcuts (see AppShell): M toggles the menu, ⌘K / Ctrl+K search, Esc closes. */
const SHORTCUTS: { action: string; hint?: string; keys: React.ReactNode }[] = [
  {
    action: "Open or close the menu",
    hint: "When you’re not typing in a field",
    keys: <Kbd>M</Kbd>,
  },
  {
    action: "Search companies, roles and pages",
    keys: (
      <>
        <Kbd label="Command K">⌘K</Kbd>
        <span className="text-xs text-faint">or</span>
        <Kbd label="Control K">Ctrl K</Kbd>
      </>
    ),
  },
  {
    action: "Close the menu or search",
    keys: <Kbd label="Escape">Esc</Kbd>,
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10">
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Help</p>
        <h1 className="m-0 mt-2.5 text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
          How can we help?
        </h1>
        <p className="m-0 mt-2 max-w-xl text-[15px] leading-[1.5] text-muted-foreground">
          Answers to common questions, and the shortcuts that get you around faster.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <HelpCard id="help-faq" title="Frequently asked questions">
          <FaqList items={FAQ_ITEMS} />
        </HelpCard>

        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
          <HelpCard id="help-shortcuts" title="Keyboard shortcuts">
            <ul className="m-0 list-none p-0">
              {SHORTCUTS.map((s) => (
                <li
                  key={s.action}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm">{s.action}</span>
                    {s.hint ? <span className="block text-xs text-faint">{s.hint}</span> : null}
                  </span>
                  <span className="ml-auto flex flex-none items-center gap-1.5">{s.keys}</span>
                </li>
              ))}
            </ul>
          </HelpCard>

          <Panel eyebrow="Still stuck?">
            <div className="iq-float flex flex-col gap-3 p-5">
              <p className="m-0 text-sm leading-[1.55]">
                Can’t find what you need? Tell us what happened and we’ll help you sort it out.
              </p>
              <Link
                href={ROUTES.contact}
                className="inline-flex items-center gap-1.5 self-start text-sm underline underline-offset-4 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Contact us
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
