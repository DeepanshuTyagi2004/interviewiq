import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";
import { CONTAINER } from "../landing/primitives";

export interface LegalSection {
  title: string;
  body: string[];
}

/** A plain-language legal page: title, last-updated date and short numbered sections. */
export function LegalPage({ title, intro, updated, sections }: { title: string; intro: string; updated: string; sections: LegalSection[] }) {
  return (
    <section className={`${CONTAINER} flex flex-col gap-10 py-16 sm:py-24`}>
      <div className="flex max-w-[680px] flex-col gap-4">
        <h1 className="m-0 text-[clamp(34px,4vw,56px)] font-normal leading-[1.02] tracking-[-0.035em]">{title}</h1>
        <p className="m-0 text-[16px] leading-[1.55] text-muted-foreground">{intro}</p>
        <p className="m-0 font-mono text-[12px] text-faint">Last updated {updated}</p>
      </div>
      <ol className="m-0 flex max-w-[680px] list-none flex-col gap-8 p-0">
        {sections.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 border-t border-line-3 pt-5">
            <h2 className="m-0 text-[18px] font-medium tracking-[-0.02em]">
              {i + 1}. {s.title}
            </h2>
            {s.body.map((p) => (
              <p key={p} className="m-0 text-[15px] leading-[1.6] text-muted-foreground">
                {p}
              </p>
            ))}
          </li>
        ))}
      </ol>
      <p className="m-0 text-[14px] text-muted-foreground">
        Questions?{" "}
        <Link href={ROUTES.contact} className="underline underline-offset-4 hover:text-foreground">
          Contact us
        </Link>
        .
      </p>
    </section>
  );
}
