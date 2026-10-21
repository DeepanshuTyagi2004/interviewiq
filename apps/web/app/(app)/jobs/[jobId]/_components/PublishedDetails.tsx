import { Card } from "@/components/ds";
import type { JdDetail } from "@/features/jobs";

/** Unknown endpoints stay unknown; zero is a real value, not a missing field. */
export function publishedRange(min: number | null | undefined, max: number | null | undefined, unit: string): string | null {
  if (min == null && max == null) return null;
  const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (min == null) return `Up to ${number(max!)} ${unit}`;
  if (max == null) return `From ${number(min)} ${unit}`;
  return `${min === max ? number(min) : `${number(min)}–${number(max)}`} ${unit}`;
}

function detailParts(jd: JdDetail) {
  const company = jd.companyOverview;
  const facts = company ? [
    { label: "Overview", value: company.overview },
    { label: "Culture", value: company.culture },
    { label: "Benefits", value: company.benefits },
  ].filter((fact) => fact.value.trim()) : [];
  // A practice template's range is the level's typical one, labelled as such; it never has pay.
  const experience = publishedRange(jd.yoeMin, jd.yoeMax, "years");
  const compensation = jd.practiceTemplate ? null : publishedRange(jd.ctcMinLpa, jd.ctcMaxLpa, "LPA");
  const sources = [...new Set(company?.sourceUrls.map((url) => url.trim()).filter(Boolean) ?? [])];
  return { company, facts, experience, compensation, sources };
}

/** Whether PublishedDetails has anything to show (the page only opens its right column then). */
export function hasPublishedDetails(jd: JdDetail): boolean {
  const { facts, experience, compensation, sources } = detailParts(jd);
  return facts.length > 0 || sources.length > 0 || Boolean(experience) || Boolean(compensation);
}

/** Explicit published facts, alongside the role's interview process in both roadmap tabs. */
export function PublishedDetails({ jd }: { jd: JdDetail }) {
  const { company, facts, experience, compensation, sources } = detailParts(jd);
  if (!hasPublishedDetails(jd)) return null;

  return (
    <aside aria-label="About this role" className="flex min-w-0 flex-col gap-4">
      {experience || compensation ? (
        <Card title="Role details" titleAs="h3" tone="stone">
          <dl className="m-0 flex flex-col gap-5">
            {experience ? (
              <div>
                <dt className="text-[13px] text-ink-3">{jd.practiceTemplate ? "Experience · typical for level" : "Experience"}</dt>
                <dd className="m-0 mt-1 font-display text-[24px] font-light tracking-[-0.03em]">{experience}</dd>
              </div>
            ) : null}
            {compensation ? (
              <div>
                <dt className="text-[13px] text-ink-3">Annual CTC · ₹ lakh</dt>
                <dd className="m-0 mt-1 font-display text-[24px] font-light tracking-[-0.03em]">{compensation}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}
      {facts.length || sources.length ? (
        <Card
          title={`About ${jd.companyName}`}
          titleAs="h3"
          meta={company?.verified ? "Admin-verified" : undefined}
          bodyClassName="flex flex-col gap-5"
        >
          {facts.map((fact) => (
            <div key={fact.label}>
              <h4 className="m-0 text-[13px] font-medium text-ink-2">{fact.label}</h4>
              <p className="mb-0 mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink-2">{fact.value}</p>
            </div>
          ))}
          {sources.length ? (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-ink-3 hover:text-foreground">Company sources</summary>
              <ul className="mb-0 mt-3 flex list-none flex-col gap-2 p-0">
                {sources.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer" className="break-all text-xs text-ink-2 underline underline-offset-4 hover:text-foreground">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}
    </aside>
  );
}
