import { HudCard } from "@/components/hud/HudCard";
import { Readout } from "@/components/hud/Readout";
import type { AdminCompany, CompanyDraft } from "@/features/research";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(key: string) {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasData(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasData);
  if (record(value)) {
    if ("value" in value) return value.provenance !== "unavailable" && hasData(value.value);
    return Object.values(value).some(hasData);
  }
  return true;
}

/** JSON values stay structured, including future fields absent from the generated schema. */
function SnapshotValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || value === "") return <span className="text-faint">Unavailable</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-faint">No entries</span>;
    const entries = (
      <ol className="m-0 list-decimal space-y-2 pl-5">
        {value.map((item, index) => <li key={index}><SnapshotValue value={item} depth={depth + 1} /></li>)}
      </ol>
    );
    return value.length > 5 ? <details><summary className="cursor-pointer text-muted-foreground">View {value.length} entries</summary><div className="mt-2">{entries}</div></details> : entries;
  }
  if (record(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return <span className="text-faint">No fields provided</span>;
    const evidence = "value" in value && ["confidence", "provenance", "source_urls", "note"].some((key) => key in value);
    const fields = (
      <dl className="m-0 space-y-3">
        {entries.filter(([key]) => !evidence || key !== "value").map(([key, item]) => (
          <div key={key} className="min-w-0">
            <dt className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label(key)}</dt>
            <dd className="m-0 border-l border-line-2 pl-3"><SnapshotValue value={item} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    );
    if (evidence) return <div className="space-y-3"><SnapshotValue value={value.value} depth={depth + 1} /><details><summary className="cursor-pointer text-xs text-muted-foreground">Evidence &amp; field metadata</summary><div className="mt-3">{fields}</div></details></div>;
    return depth > 1 ? <details><summary className="cursor-pointer text-muted-foreground">View {entries.length} fields</summary><div className="mt-3">{fields}</div></details> : fields;
  }
  if (typeof value === "string" && safeUrl(value)) {
    return <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-4">{value}</a>;
  }
  return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{String(value)}</span>;
}

const EXPECTED_SECTIONS = [
  { title: "Company profile", keys: /^(company_?profile|profile|overview|company)$/i },
  { title: "Compensation / culture", keys: /^(compensation|culture|compensation_?(and_?)?culture|benefits|salary|salaries)$/i },
  { title: "Roles / interview processes", keys: /^(roles|interviews?|interview_?process(es)?|roles_?(and_?)?interview_?process(es)?)$/i },
];

export function DraftResearchReport({ draft, company }: { draft: CompanyDraft; company: AdminCompany }) {
  const snapshot: unknown = draft.snapshot;
  const sections = record(snapshot) ? Object.entries(snapshot) : [];
  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      <HudCard title="Research snapshot" bodyClassName="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Readout label="Draft version" value={draft.version} size="sm" />
          <Readout label="Status" value={label(draft.status)} size="sm" />
          <Readout label="Snapshot sections" value={sections.length} size="sm" />
          {draft.coverage ? (
            <Readout label="Coverage" value={`${draft.coverage.filled}/${draft.coverage.total}`} size="sm"
              unit={draft.coverage.filled < draft.coverage.total ? "partial" : undefined} />
          ) : null}
        </div>
        <p className="mb-0 mt-4 text-xs text-muted-foreground">Only information present in this draft is shown. Unavailable sections have no research data in this snapshot.</p>
      </HudCard>

      {draft.notes?.length ? (
        <HudCard title="Research notes" bodyClassName="p-4 sm:p-5">
          <ul className="m-0 list-disc space-y-2 pl-5 text-muted-foreground">
            {draft.notes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
        </HudCard>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {sections.map(([key, value]) => (
          <HudCard key={key} title={label(key)} bodyClassName="space-y-4 p-4 sm:p-5">
            <SnapshotValue value={value} />
            {key === "identity" ? (
              <details className="border-t border-line pt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">Current company identity · for comparison</summary>
                <div className="mt-3"><SnapshotValue value={{ name: company.name, website: company.website, aliases: company.aliases }} /></div>
              </details>
            ) : null}
          </HudCard>
        ))}
        {EXPECTED_SECTIONS.filter((section) => !sections.some(([key, value]) => section.keys.test(key) && hasData(value))).map((section) => (
          <HudCard key={section.title} title={section.title} meta="Unavailable" glow="none" bodyClassName="p-4 sm:p-5">
            <p className="m-0 text-muted-foreground">Not available in this draft snapshot.</p>
          </HudCard>
        ))}
      </div>

      <details className="min-w-0 rounded-xl border border-line-2 bg-card p-4">
        <summary className="cursor-pointer font-mono text-xs text-muted-foreground">Raw snapshot · complete JSON</summary>
        <pre className="mb-0 mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </div>
  );
}
