import { useId, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

/** LinkedIn redirects /in/me/ to the signed-in member's own profile. */
const OWN_PROFILE_URL = "https://www.linkedin.com/in/me/";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[11px] text-ink-3">
        {n}
      </span>
      <div className="min-w-0 flex-1 leading-[1.55]">{children}</div>
    </li>
  );
}

function Ui({ children }: { children: ReactNode }) {
  return <span className="rounded bg-surface-2 px-1.5 py-px font-medium text-foreground">{children}</span>;
}

/**
 * How to download LinkedIn's own "Save to PDF" export. LinkedIn offers no API for career history,
 * so the candidate downloads the file themselves; we never fetch anything from LinkedIn.
 */
export function LinkedInPdfSteps({ profileUrl }: { profileUrl: string | null }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-[16px] bg-surface p-4">
      <h3 id={headingId} className="m-0 text-sm font-medium">Get your LinkedIn PDF</h3>
      <ol className="m-0 mt-3 list-none space-y-3 p-0 text-sm">
        <Step n={1}>
          <p className="m-0">On a computer, open your LinkedIn profile.</p>
          <a href={profileUrl ?? OWN_PROFILE_URL} target="_blank" rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-foreground underline underline-offset-4">
            Open my LinkedIn profile
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Step>
        <Step n={2}>
          <p className="m-0">Click <Ui>Resources</Ui> below your name, then <Ui>Save to PDF</Ui>.</p>
          <p className="m-0 mt-1 text-xs text-muted-foreground">On older layouts the button is called <Ui>More</Ui>.</p>
        </Step>
        <Step n={3}>
          <p className="m-0">A file, usually <code className="font-mono text-[13px]">Profile.pdf</code>, downloads. Upload it below.</p>
        </Step>
      </ol>
      <p className="m-0 mt-3 text-xs leading-[1.55] text-muted-foreground">
        Save to PDF only works in a desktop browser, not the LinkedIn app. On a phone, open linkedin.com in your browser and
        try its &ldquo;Desktop site&rdquo; option. It isn&rsquo;t available for profiles written in Chinese, Japanese, Korean,
        Russian, Arabic or Thai.
      </p>
    </section>
  );
}
