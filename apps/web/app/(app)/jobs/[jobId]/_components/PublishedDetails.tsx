import { HudCard } from "@/components/hud";
import type { JdDetail } from "@/features/jobs";

/** Unknown endpoints stay unknown; zero is a real value, not a missing field. */
export function publishedRange(min: number | null | undefined, max: number | null | undefined, unit: string): string | null {
  if (min == null && max == null) return null;
  const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (min == null) return `Up to ${number(max!)} ${unit}`;
  if (max == null) return `From ${number(min)} ${unit}`;
  return `${min === max ? number(min) : `${number(min)}–${number(max)}`} ${unit}`;
}

/** Explicit published facts, alongside the role's interview process in both roadmap tabs. */
export function PublishedDetails({ jd }: { jd: JdDetail }) {
  const company = jd.companyOverview;
  const facts = company ? [
    { label: "Overview", value: company.overview },
    { label: "Culture", value: company.culture },
    { label: "Benefits", value: company.benefits },
  ].filter((fact) => fact.value.trim()) : [];
  const experience = publishedRange(jd.yoeMin, jd.yoeMax, "years");
  const compensation = publishedRange(jd.ctcMinLpa, jd.ctcMaxLpa, "LPA");
  const sources = [...new Set(company?.sourceUrls.map((url) => url.trim()).filter(Boolean) ?? [])];
  if (!facts.length && !sources.length && !experience && !compensation) return null;

  return <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.4fr)]">
    {facts.length || sources.length ? <HudCard title={`About ${jd.companyName}`} meta={company?.verified ? <span className="font-mono text-[11px] text-muted-foreground">Admin-verified</span> : undefined} className={!experience && !compensation ? "lg:col-span-2" : undefined} bodyClassName="space-y-5 p-5 sm:p-6">
      {facts.map((fact) => <div key={fact.label}><h3 className="m-0 text-sm font-medium">{fact.label}</h3><p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{fact.value}</p></div>)}
      {sources.length ? <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Company sources</summary><ul className="mb-0 mt-3 space-y-2 pl-4">{sources.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all text-xs underline underline-offset-4">{url}</a></li>)}</ul></details> : null}
    </HudCard> : null}
    {experience || compensation ? <HudCard title="Role details" bodyClassName="space-y-5 p-5 sm:p-6"><dl className="m-0 space-y-5">
      {experience ? <div><dt className="text-sm text-muted-foreground">Experience</dt><dd className="m-0 mt-2 font-mono text-lg">{experience}</dd></div> : null}
      {compensation ? <div><dt className="text-sm text-muted-foreground">Annual CTC · ₹ lakh</dt><dd className="m-0 mt-2 font-mono text-lg">{compensation}</dd></div> : null}
    </dl></HudCard> : null}
  </div>;
}
