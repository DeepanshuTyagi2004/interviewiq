# LinkedIn PDF import

The candidate downloads LinkedIn's own **Save to PDF** export of their profile and uploads it with
explicit consent. The upload declares the profile is theirs; this is **not ownership
verification**. Nothing is fetched from LinkedIn: no scraping, no OAuth grant, no login cookie, no
name search. The consent UI discloses that the configured AI service reads the PDF to prepare a
draft, and that only confirmed sections are imported.

Why a PDF: LinkedIn's API exposes no career history, and third-party scraping is a legal and
terms-of-service risk (Firecrawl now gates profile pages behind a person-data "enrichment" opt-in
that returns a data-broker record rather than the page). The user-generated export is free and
complete, and the user stays in control of what is shared. Posts are out of scope.

## How the candidate gets the PDF

Shown on the Connections LinkedIn row's import dialog:

1. On a computer, open your LinkedIn profile (deep link: the resume-detected profile URL when
   known, else `https://www.linkedin.com/in/me/`).
2. Click **Resources** below your name (older layouts: **More**), then **Save to PDF**.
3. Upload the downloaded file (usually `Profile.pdf`).

Save to PDF is desktop-browser only (not the LinkedIn app) and unavailable for profiles written in
Chinese, Japanese, Korean, Russian, Arabic or Thai.

## HTTP contract

All public endpoints require the usual bearer access token and live under
`/api/v1/users/me/linkedin`. Errors have the standard `{code,message}` envelope.

- `GET /`: current import status.
- `POST /imports`: `multipart/form-data` with `file` (the PDF, up to 5 MB) and `consent=true`.
  Success is **201** with an unsaved, owner-only review draft. Errors:
  - 400 `linkedin_consent_required`, `linkedin_pdf_missing`, `linkedin_import_invalid`
  - 409 `linkedin_import_busy`, `linkedin_import_cancelled` (LinkedIn disconnected mid-read)
  - 413 `linkedin_pdf_too_large`
  - 415 `linkedin_import_unsupported_media` (not multipart), `linkedin_pdf_unsupported_media`
    (file does not start with `%PDF-`)
  - 422 `linkedin_pdf_unrecognized` (not LinkedIn's export), `linkedin_pdf_unreadable` (no text
    layer, encrypted or corrupt), `linkedin_pdf_no_claims` (no evidenced career claims)
  - 429 `linkedin_draft_limit` (three unexpired drafts)
  - 503 `linkedin_import_disabled`, `linkedin_extractor_unavailable`
- `POST /imports/:id/confirm`: `{"sections":["experience","skills"],"mergeProfile":false}`.
  `mergeProfile` defaults to false. Success is 200 with `{profile,import}`; profile is null for a
  source-only import. Only selected, present sections and their evidence reach the source fragment.
- `DELETE /`: 204; removes the LinkedIn source and all drafts. Claims explicitly merged into the
  editable candidate profile remain there, and can be edited/deleted normally.

Draft shape:

```json
{
  "id":"00000000-0000-4000-8000-000000000001",
  "createdAt":"2026-10-04T12:00:00.000Z",
  "expiresAt":"2026-10-05T12:00:00.000Z",
  "method":"pdf",
  "profileRevision":null,
  "sourceUrl":"https://www.linkedin.com/in/example-engineer/",
  "provider":null,
  "retrievedAt":null,
  "profile":{"level":null,"headline":null,"fullName":null,"email":null,"phone":null,"location":null,"targetRole":null,"targetJdId":null,"education":[],"experience":[],"projects":[],"skills":["Python"],"achievements":[],"detectedLinks":{"github":null,"leetcode":null,"linkedin":null},"resumeFilename":null,"resumeParsedAt":null,"onboardingComplete":false},
  "sections":[{"key":"skills","label":"Skills","entries":["Python"],"sourceFile":"Profile.pdf"}],
  "warnings":["This is a snapshot of the PDF you uploaded; it does not update when your LinkedIn profile changes."]
}
```

`sourceUrl` is the profile link printed in the PDF's contact block, canonicalized, or null when
absent or unsafe. `sourceFile` is the uploaded filename (control characters and path separators
removed, at most 120 characters), shown for provenance only.

Status shape (also `confirm.import`):

```json
{"connected":true,"importedAt":"2026-10-04T12:01:00.000Z","method":"pdf","sections":["skills"],"warnings":[],"sourceUrl":"https://www.linkedin.com/in/example-engineer/","provider":null,"retrievedAt":null}
```

Disconnected fields are null with `sections:[]`, `warnings:[]`, `connected:false`.
Section keys: `headline`, `about`, `experience`, `education`, `projects`, `skills`, `achievements`,
`certifications`, `publications`, `patents`, `courses`, `languages`, `volunteering`.
About stays a source section; it is not substituted for the candidate headline.

**Legacy URL snapshots.** Sources confirmed by the retired Firecrawl/Exa URL import
(`method:"url"`, `provider:"firecrawl"|"exa"`, `retrievedAt` set) stay readable and connected until
the candidate replaces or removes them. New imports are always `method:"pdf"`.

## Extraction

The API forwards the raw bytes to internal **POST `/linkedin/parse`** (`Content-Type:
application/pdf`, `X-Internal-Api-Key`), the same raw-body pattern as `/resumes/parse`. The AI
service (`app/linkedin/pdf.py`, `app/linkedin/api.py`):

1. Extracts the plain text layer with pypdf (no OCR). Under 200 characters, encrypted or corrupt
   gives `linkedin_pdf_unreadable`.
2. Recognises LinkedIn's export: a `linkedin.com/in/…` link **and** either the contact block's
   `(LinkedIn)` marker or a `Page N of M` footer. A resume that merely links to LinkedIn has
   neither and gives `linkedin_pdf_unrecognized`.
3. Removes page footers and redacts email addresses before the text reaches the LLM.
4. Runs one private LLM call (resume model, diagnostics capture off) and the exact-quote evidence
   gate: every value must sit inside its quote and every quote inside the PDF text (whitespace is
   compared collapsed, because PDF text wraps mid-sentence). Unsupported claims are dropped; no
   surviving claims gives `linkedin_pdf_no_claims`.

The extraction is capped at two minutes; LLM failure or timeout gives 503
`linkedin_extractor_unavailable`. The API maps the AI service's 422/413 codes to its own constant
messages and never forwards upstream text. Names, contacts and engineering level are not imported.
Claims are self-reported, not verified employment, education or skills.

## Storage and merge

The PDF and its text are never stored or logged. Only bounded derived drafts/evidence are
retained, up to three unexpired drafts per owner with 24-hour expiry (Mongo TTL plus synchronous
expiry checks). Account export includes active derived drafts; account deletion removes them. The
source fragment is `LINKEDIN`, with
`{importMethod:"pdf",importedAt,partial,sourceUrl,provider:null,retrievedAt:null,profile,sections,provenance,warnings}`.
Each provenance item is `{section,path,file,quote}` with `file` the display filename. Source profile
contains only selected career fields; extended sections stay in section entries.

### Concurrency

A short cross-replica per-user mutation lease covers the capacity check and the draft write, never
the LLM call. A per-user epoch fences an in-flight extraction: disconnecting LinkedIn while a PDF is
being read makes that upload fail with `linkedin_import_cancelled` instead of recreating a draft.
Failed uploads leave nothing behind; the candidate can retry immediately. There is no paid-attempt
guard because no paid provider is called.
