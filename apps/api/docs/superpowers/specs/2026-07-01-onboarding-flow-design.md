# Onboarding Flow — End-to-End Design

**Date:** 2026-07-01
**Status:** Approved, implementing
**Repos touched:** interviewiq-ai-service, interviewiq-backend, interviewIQ-frontend, interviewiq-infra

## Goal

After Google SSO, a **new** user is taken through onboarding: upload a résumé → parse it
synchronously into clean structured JSON with an LLM (Gemini Flash via the existing ai-service
LLM client) → a 3-step stepper (1 Personal details, 2 Education & Experience, 3 Connectors),
prefilled from the résumé and fully editable → save on finish → redirect to dashboard. The saved
details show on the profile page and can be edited later, including re-uploading the résumé.

## Locked decisions

- **CandidateProfile entity** (1:1 with `User`) holds the editable structured data. It is
  *separate* from the descriptive Profile Builder synthesis contract (`ProfileFragment`), which is
  left untouched. A `source=RESUME` fragment for synthesis can be added later (YAGNI).
- **JSONB** columns for `education[]`, `experience[]`, `skills[]`, `detected_links` (no child tables).
- **Dedicated `RESUME_LLM_MODEL`** env var in ai-service, reusing the existing API keys / round-robin
  client. Falls back to `LLM_MODEL_NAME` when unset.
- **Résumé is skippable**; manual entry is always available (sources are additive, never required).
- **Résumé file is not persisted** — only structured JSON + original filename + `resumeParsedAt`.
  "Change résumé" = re-upload + re-parse.
- **Single final commit**: the wizard holds a client-side draft; on Finish it PUTs the assembled
  profile and flips `onboardingComplete`. (Mid-wizard refresh loses unsaved edits — acceptable MVP.)

## Repo placement

**ai-service is a stateless parser** (owns the LLM + PDF text extraction). **Backend owns**
file upload, persistence, and gating. **Frontend owns** the wizard and draft state.

## Data flow (synchronous parse)

```
Onboarding: upload PDF
  → FE  POST /api/v1/users/me/resume:parse (multipart, Bearer)
  → BE  validate (application/pdf, ≤ 5 MB) → forward raw bytes
       POST {aiservice}/resumes/parse (X-Internal-Api-Key, application/pdf, ~90s read timeout)
  → AI  pypdf text extraction → LLM (RESUME_LLM_MODEL) → ParsedResume (Pydantic) → JSON
  → BE  map → ParsedResumeResponse (NOT persisted)
  → FE  prefill wizard (RHF defaultValues)

Stepper 1 Personal · 2 Education & Experience · 3 Connectors  (edit freely)
  → Finish: FE PUT /api/v1/users/me/candidate-profile { ...fields, complete: true }
  → BE  upsert CandidateProfile, set user.onboardingComplete = true
  → FE  redirect → /dashboard

Profile page: GET candidate-profile → show; Edit → same PUT; Change résumé → re-parse → merge.
```

## ai-service

- `requirements.txt`: add `pypdf>=4.0`.
- `app/config.py`: `resume_llm_model: str = Field("", alias="RESUME_LLM_MODEL")` (empty → falls back
  to `llm_model`).
- `app/llm/client.py`: `build_llm_client(settings, *, model=None)` — optional model override.
- `app/resume/extract.py`: `extract_text(pdf_bytes) -> str`; raises `ResumeExtractError` on
  empty / unreadable / image-only PDFs.
- `app/models/resume.py`: `ParsedResume` (personal, links, education[], experience[], skills[]),
  tolerant validators. Descriptive only — **no scoring**.
- `app/prompts/parse_resume.py`: `RESUME_SYSTEM` + `build_parse_resume_prompt(text)`.
- `app/api/routes.py`: `POST /resumes/parse` (internal key). Reads raw body bytes → extract → LLM →
  validate → return `ParsedResume.model_dump()`. 422 on unreadable PDF.
- Tests: `tests/test_resume_parse.py` — extraction, schema coercion, endpoint with mocked LLM.

## backend

- `models/User.java`: add `onboardingComplete boolean` (default false). Surface in `UserResponse`
  + `GET /api/v1/users/me`.
- New `models/CandidateProfile.java` (`candidate_profile` table): `id`, `user_id` (unique FK),
  `fullName`, `email`, `phone`, `location`, `headline`, `targetRole`, `education` (jsonb),
  `experience` (jsonb), `skills` (jsonb), `detectedLinks` (jsonb), `resumeFilename`,
  `resumeParsedAt`, `createdAt`, `updatedAt`.
- `repositories/CandidateProfileRepository` (`findByUserId`).
- DTOs: `ParsedResumeResponse`, `CandidateProfileRequest`, `CandidateProfileResponse`.
- `services/CandidateProfileService`: parse-proxy, get, upsert (+ flip onboarding flag).
- `controllers/CandidateProfileController`:
  - `POST /api/v1/users/me/resume:parse` (multipart) → proxy → `ParsedResumeResponse`.
  - `GET  /api/v1/users/me/candidate-profile`.
  - `PUT  /api/v1/users/me/candidate-profile`.
- `AiServiceClient.parseResume(bytes, filename)` (RestClient, application/pdf, internal key).
- `application.properties`: multipart max-file-size 6MB / max-request-size 6MB; ai-service resume
  read timeout.
- Security: new endpoints authenticated (default rule); multipart allowed.

## frontend (Geist design system)

- `/me` type + `useCurrentUser`: add `onboardingComplete`.
- Gating: `auth/callback` routes new users → `/onboarding`; an `OnboardingGate` in the `(app)`
  layout bounces incomplete users to `/onboarding`; `/onboarding` redirects complete users to
  `/dashboard`.
- `/onboarding` wizard (single route, in-memory draft): résumé-upload pre-step (drop-zone, parse
  spinner, **Skip**) → `Stepper` [1 Personal · 2 Education & Experience · 3 Connectors].
  - New primitives (Geist tokens, no new lib): `Stepper`, `ResumeDropzone`.
  - Reuse shadcn `Form`/`Input`/`Card`/`Button`, sonner toasts.
  - Step 2 uses RHF `useFieldArray` for repeating rows.
  - Step 3 reuses existing `ConnectionsGrid`, prefilled by `detected_links`; connectors optional →
    **Finish** commits.
- `features/onboarding/`: api client, hooks (`useParseResume`, `useCandidateProfile`,
  `useSaveCandidateProfile`), zod schemas, types. Endpoint constants in `lib/constants`.
- Profile page: new "Personal / Education / Experience" section from `candidate-profile`; **Edit**
  reuses the step forms; **Change résumé** re-parses + merges.

## infra

- `.env.example` entries for `RESUME_LLM_MODEL` (ai-service). Note the added `pypdf` dependency and
  the deliberate use of LLM parsing instead of Affinda.

## Testing

- ai-service: pytest (parse endpoint, schema coercion, unreadable-PDF fallback).
- backend: service + controller tests, multipart, mocked `AiServiceClient`.
- frontend: zod validation, wizard navigation, gating redirect.

## Build order

ai-service parse endpoint → backend persistence/proxy → frontend wizard → verify → review.

## Post-review fixes (adversarial review, 2026-07-01)

A 4-dimension adversarial review (backend / ai-service / frontend / cross-repo contract) with an
independent verify pass confirmed 7 edge-case findings (all medium/low; no critical/high, no
security or happy-path data issues). Fixes applied:

1. **Frontend (medium)** — `OnboardingWizard` set `seeded=true` in `handleParsed`/`goToSteps` so a
   late-resolving `useCandidateProfile` GET can't overwrite freshly parsed/entered data.
2. **Backend (medium)** — a malformed/empty ai-service 2xx body no longer 500s: `AiServiceClient`
   rejects a blank body as a `RestClientException` (→502) and the controller maps
   `tools.jackson.core.JacksonException` → 502 `resume_parse_failed`.
3. **ai-service (medium)** — `LLMClient.complete()` now catches a no-salvageable-JSON `parse_json`
   failure and routes it through the retry→`LLMError` path (never escapes as a bare `ValueError`),
   so the résumé route returns 502 not 500.
4. **Backend (medium)** — multipart size limits are enforced before handler resolution, so a new
   global `UploadExceptionAdvice` (`@RestControllerAdvice`) maps `MaxUploadSizeExceededException`
   → 413 `resume_too_large` (the controller-local handler couldn't catch the pre-resolution throw).
5. **ai-service (low)** — password-protected/undecryptable PDFs: the page-iteration loop catches
   `PdfReadError` (incl. `FileNotDecryptedError`) → clean 422 instead of a 500.
6. **Frontend (low)** — `formToRequest` keeps an experience row that has only `startDate`/`endDate`
   (previously dropped).

**Known, accepted (low/cosmetic):** `resumeParsedAt` change-detection keys on filename, so
re-parsing a different résumé that reuses the same filename (e.g. `resume.pdf`) leaves the
displayed parse timestamp stale. Profile content is always overwritten on save, so no data is
stale — only the display timestamp. Not worth content-hashing for a cosmetic field.
