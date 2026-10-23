import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";
import { CONTAINER, OutlineLink } from "../_components/landing/primitives";

export const metadata: Metadata = {
  title: "Contact — InterviewIQ",
  description: "Book a demo for your college, or get help with your account.",
};

/** The address demos and support go to; unset until a mailbox is chosen, and the page says so honestly. */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

const PATHS = [
  {
    eyebrow: "COLLEGES AND COMPANIES",
    title: "Book a demo",
    body: "Tell us about your placement calendar or hiring loop and we will set up a pilot with you.",
    subject: "InterviewIQ demo",
  },
  {
    eyebrow: "STUDENTS AND PROFESSIONALS",
    title: "Get help with your account",
    body: "Most answers are in the help page inside the app. For anything else, write to us with what happened.",
    subject: "InterviewIQ support",
  },
];

export default function ContactPage() {
  return (
    <section className={`${CONTAINER} flex flex-col gap-10 py-16 sm:py-24`}>
      <div className="flex max-w-[640px] flex-col gap-4">
        <h1 className="m-0 text-[clamp(34px,4vw,56px)] font-normal leading-[1.02] tracking-[-0.035em]">Talk to us.</h1>
        <p className="m-0 text-[16px] leading-[1.55] text-muted-foreground">
          Two reasons people write: a college or company wants a demo, or someone needs help with their account. Pick yours.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {PATHS.map((p) => (
          <div key={p.eyebrow} className="flex flex-col gap-4 iq-glass-card p-6 sm:p-8">
            <h2 className="m-0 text-[24px] font-semibold leading-[1.1] tracking-[-0.03em]">{p.title}</h2>
            <p className="m-0 -mt-2 text-sm text-ink-3">{p.eyebrow}</p>
            <p className="m-0 text-[15px] leading-[1.55] text-muted-foreground">{p.body}</p>
            {CONTACT_EMAIL ? (
              <OutlineLink href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(p.subject)}`} className="mt-auto h-10 w-fit px-[18px]">
                Email {CONTACT_EMAIL}
              </OutlineLink>
            ) : (
              <p className="m-0 mt-auto text-[13px] text-muted-foreground">A contact address is on its way; until then, reach the team the way you signed up.</p>
            )}
          </div>
        ))}
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">
        Already using InterviewIQ? The{" "}
        <Link href={ROUTES.help} className="underline underline-offset-4 hover:text-foreground">
          help page
        </Link>{" "}
        answers the common questions.
      </p>
    </section>
  );
}
