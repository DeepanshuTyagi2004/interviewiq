# Profile Builder — GitHub Vertical Slice + App Shell, Connections Page & Charts (Design)

**Date:** 2026-06-06
**Status:** Approved (brainstorming complete; ready for implementation plan). Amended 2026-06-06 to add a shadcn app shell (cherry-picked from the `dashboard-01` block), a dedicated top-level `/connections` page, and shadcn/Recharts visualizations.
**Repos touched:** `interviewiq-backend` (Spring Boot), `interviewiq-frontend` (Next.js 16)

---

## 1. Goal & scope

Ship the first end-to-end vertical slice of Profile Builder (Module 01): a student
connects their **GitHub** account, the backend fetches their public GitHub data via
OAuth + GraphQL, normalizes and stores it as a `ProfileFragment`, and the frontend
renders a **consolidated, dark, Vercel-aesthetic profile page** (Layout A) with the
GitHub source live and other sources shown as "Connect" placeholders.

**This slice deliberately stops before LLM synthesis.** The consolidated "Notable"
and "Skills" bands are assembled by **simple backend rules** as a stand-in, structured
so the real synthesis service can replace them later without a frontend change.

### In scope
- GitHub account connection: a **second, separate** OAuth2 authorization-code flow
  (distinct from the existing Google `oauth2Login` used for app login).
- Encrypted GitHub access-token storage (AES-256-GCM).
- GitHub collector: one GraphQL query → normalized fragment JSON.
- `ProfileFragment` storage + content hashing (hash-based change detection).
- Synchronous fetch on connect + a weekly `@Scheduled` background refresh.
- Read API: `GET /api/v1/profile/me` → consolidated profile DTO.
- Frontend consolidated profile page (Layout A), dark-first, full Vercel aesthetic.
- **Adopt shadcn/ui as the component layer**, and use the **app shell cherry-picked from the `dashboard-01` block** (collapsible sidebar + header + nav) adapted into `app/(app)/layout.tsx` (currently a `RequireAuth` TODO stub).
- **A dedicated top-level Connections page** at `app/(app)/connections/page.tsx` — the connect/disconnect/manage hub — distinct from the read-only `/profile` display (see §5b).
- **Render GitHub/LeetCode visual data with shadcn `chart` (Recharts) components**; the GitHub contribution heatmap and stat tiles stay custom.

### Out of scope (deferred, explicit)
- LLM synthesis + the Python `interviewiq-synthesis` service.
- Résumé / LeetCode / LinkedIn / X collectors (chips render as "Connect" placeholders).
- Tutorial-repo detection heuristic (flagged IP; needs human review).
- Background job queue (jobrunr/Quartz/etc. — open decision stays deferred).
- Per-user private-repo data (scope is `read:user` only).
- `dashboard-01` demo content (SectionCards, ChartAreaInteractive, demo DataTable, `data.json`, nav-documents) — **not installed**. We cherry-pick only the shell (sidebar/header/nav); the `@dnd-kit` + `@tanstack/react-table` deps are **not** pulled in this slice (CLAUDE.md "ruthless on complexity"). A data table is added later when interviews/jobs need one.
- Manual on-demand refresh endpoint/affordance — not built; refresh stays background-only (weekly) per CLAUDE.md.

---

## 2. Decisions locked during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Slice depth | Connect → collect → render raw | Avoids IP-sensitive synthesis prompt + missing Python service |
| Where it lives | This `interviewiq-backend` (single Spring repo) | Pre-revenue discipline; no new repo/service |
| GitHub access | Per-user GitHub OAuth | Gets contribution graph + external PRs |
| OAuth scope | `read:user` only | Minimal consent; public profile is enough for V1 |
| Token storage | AES-256-GCM, key in env | Pragmatic; KMS upgrade path documented |
| Profile layout | Layout A — highlights band + source-card grid | Scales as sources are added (one card each) |
| "How good" framing | Evidence density, **never a score** | CLAUDE.md hard rule: no scoring/ranking ever |
| GitHub fetch | One GraphQL query via Spring `RestClient` | No new dependency; contribution graph is GraphQL-only |
| Fetch timing | Synchronous on connect (~1–2s) + weekly `@Scheduled` | Simple; honors "background refresh, not on page-load" without a queue |
| Consolidated bands | Backend rule-based stand-in for synthesis | Swappable for the synthesis service later, no FE change |
| App shell | shadcn `dashboard-01`, **cherry-picked** into `(app)/layout.tsx` | Battle-tested collapsible sidebar + header; skip demo content/table deps |
| Connections UX | Dedicated **top-level `/connections`** route (not nested under `/profile`) | Peer-level hub reachable from onboarding/profile/settings; `/profile` stays read-only |
| Connect return | Redirect → back to `/connections` (default), configurable | Matches synchronous fetch-on-connect; user-confirmed |
| Charts | shadcn `chart` base + Recharts; heatmap & stat tiles custom | One chart primitive composes pie/bar; Recharts has no heatmap primitive |
| shadcn style | `new-york`, `slate` base, cssVariables, lucide icons | Research-validated `components.json`; reuses existing HSL tokens + `cn()` |

---

## 3. Backend architecture (`interviewiq-backend`)

New package: `com.interviewiq.interviewiq_backend.profile`.

### Entities
- **`GitHubConnection`** — `id`, `userId` (FK, unique), `githubLogin`, `accessTokenEnc`
  (AES-256-GCM ciphertext), `scope`, `connectedAt`, `lastRefreshedAt`. One per user.
- **`ProfileFragment`** — `id`, `userId` (FK), `source` (enum `GITHUB`, future: `RESUME`,
  `LEETCODE`, …), `data` (JSONB), `contentHash`, `version`, `fetchedAt`.
  Unique on (`userId`, `source`). Source-agnostic.

### Services
- **`TokenCipher`** — AES-256-GCM encrypt/decrypt; key from `GITHUB_TOKEN_KEY` env
  (base64, 32 bytes). Random 12-byte IV per encryption, prepended to ciphertext.
- **`GitHubOAuthService`** — builds the GitHub authorize URL (state param for CSRF),
  exchanges the code for an access token, encrypts + upserts `GitHubConnection`.
- **`GitHubCollector`** — issues one GraphQL POST via `RestClient`, maps the response
  into the normalized fragment JSON (see §4), computes `contentHash`, upserts the
  `ProfileFragment` only if the hash changed (else just bumps `fetchedAt`).
- **`ProfileAssembler`** — rule-based stand-in for synthesis: derives the `notable`
  highlights, `mostUsedSkills` (with evidence strings), and `atAGlance` items from the
  available fragments. **Isolated behind an interface** so the synthesis service can
  replace it later.
- **`ProfileService`** — orchestrates: read fragments + connections → assemble DTO.

### Controllers / endpoints
- `GET  /api/v1/connections/github/authorize` → 302 redirect to GitHub (auth required).
- `GET  /api/v1/connections/github/callback?code&state` → exchange, store, **fetch
  synchronously**, then 302 redirect to the frontend (`FRONTEND_CONNECTIONS_REDIRECT`, default `{frontend}/connections`).
- `DELETE /api/v1/connections/github` → disconnect (delete connection + GitHub fragment).
- `GET  /api/v1/profile/me` → consolidated `ProfileResponse` DTO.

**Endpoint notes:**
- The callback's frontend redirect target is configurable via `FRONTEND_CONNECTIONS_REDIRECT` (default `{frontend}/connections`) so the user returns to the page they initiated connect from. The GitHub OAuth App callback URL itself is unchanged.
- `POST /api/v1/connections/github/refresh` (manual refresh) is a **flagged future endpoint — NOT built in this slice.** The Connections UI's Refresh affordance stays hidden until it exists, so no on-demand fetch ships (keeps CLAUDE.md's weekly-refresh rule intact).

### Security (SecurityConfig)
- New connection endpoints require the Bearer JWT (existing resource-server config).
- `state` param validated on callback (CSRF for the OAuth handshake).
- Token at rest is **encrypted, never logged**; `accessTokenEnc` excluded from any DTO.

---

## 4. GitHub fragment JSON (normalized, stored in `ProfileFragment.data`)

```jsonc
{
  "login": "aishav",
  "name": "Aisha Verma",
  "avatarUrl": "https://...",
  "joinedYear": 2021,
  "publicRepos": 38,
  "contributions": {
    "lastYear": 1204,
    "weeks": [ [0,1,3,0,2,5,1], ... ]   // 52 weeks x 7 days of counts (heatmap)
  },
  "languages": [ { "name": "TypeScript", "pct": 48, "bytes": 1234567 }, ... ],
  "externalPRs": 17,
  "topRepos": [ { "name": "campus-placement-bot", "stars": 42, "primaryLang": "TypeScript" }, ... ]
}
```

- `contentHash` = SHA-256 over canonical (key-sorted) JSON of `data`.
- One GraphQL query fetches: `user { login name avatarUrl createdAt repositories(...)
  { totalCount nodes { stargazerCount primaryLanguage languages } } contributionsCollection
  { contributionCalendar pullRequestContributionsByRepository } }`. Exact query refined
  in the implementation plan.
- **Skip list** (per CLAUDE.md): fork counts, total commits, tutorial repos. Tutorial
  detection is deferred — V1 ranks `topRepos` by stars + recent push, with a marked hook.

---

## 5. Frontend (`interviewiq-frontend`)

### 5a. shadcn setup + app shell + profile page

- **shadcn setup** — `npx shadcn@latest init` (style `new-york`, base `slate`, cssVariables,
  lucide icons; reuses existing `globals.css` HSL tokens + `lib/utils/cn.ts`). Writes
  `components.json` at repo root. Exact config + commands in §7.
- **App shell** — cherry-pick the `dashboard-01` shell into **`app/(app)/layout.tsx`**:
  `SidebarProvider` + `AppSidebar` + `SidebarInset` + `SiteHeader` wrapping `{children}`.
  **Auth gating preserved**: `RequireAuth` wraps the shell (don't drop client-side gating
  when swapping the current stub layout).
  - Adapt `app-sidebar` — `navMain` → **Dashboard / Profile / Connections** (lucide
    `LayoutDashboard` / `UserCircle` / `Link2`); `nav-user` → bind to auth session + Logout;
    `nav-secondary` → Help/Feedback. Keep `nav-main` / `nav-secondary` / `site-header`.
    **Do NOT install** `nav-documents`, `section-cards`, `chart-area-interactive`,
    `data-table`, `data.json` — cherry-pick avoids the `@dnd-kit` + `@tanstack/react-table` deps.
  - `/dashboard` renders a simple placeholder this slice (so sidebar nav isn't broken).
- **Profile page** (`app/(app)/profile/page.tsx`) — Layout A consolidated view, dark-first,
  Vercel aesthetic. Read-only display; connected sources' data + "Connect" placeholders for
  the rest; a **"Manage connections"** link → `/connections`.
- **`features/profile/`** — `api/getMyProfile.ts` (typed, via `apiFetch`),
  `hooks/useProfile.ts` (TanStack Query `useQuery` on `GET /api/v1/profile/me`),
  `types/profile.ts`.
- **Visualizations** (in `components/visualizations/`), built on the shadcn `chart` base (Recharts):
  - `LanguageDistribution` → **pie**; `LeetCodeDifficulty` → **pie** (Easy/Med/Hard, color-coded);
    `LeetCodeTopics` → **bar**.
  - `ContributionHeatmap` → **CUSTOM** 52×7 Tailwind grid (Recharts has no heatmap primitive).
  - GitHub stat tiles → **CUSTOM** shadcn `Card` + mono numerals + lucide icons (not charts).

### 5b. Connections page

- **Route:** **`app/(app)/connections/page.tsx`** — top-level, peer to `/profile` and
  `/dashboard`. The dedicated **connect / disconnect / manage hub**. The existing stubs
  `app/(app)/profile/connections/page.tsx` and `app/(app)/onboarding/connections/page.tsx`
  become thin **redirects** to `/connections` (onboarding may keep a guided wrapper), so
  there is a single implementation.
- **Relationship to `/profile`:** `/profile` = read-only display; `/connections` =
  management. Both call `GET /api/v1/profile/me`; only `/connections` invokes mutations.
- **Components** (route-private under `app/(app)/connections/_components/`):
  - `ConnectionsGrid` — responsive grid of `ProviderCard`s (GitHub live; Résumé, LeetCode,
    LinkedIn, X as placeholders; scales horizontally as sources are added).
  - `ProviderCard` — per-source state machine:
    `not-connected | connecting | connected | error | refreshing`. Shows icon, description,
    status badge + last-refreshed, and the right action(s). shadcn primitives + `cva` variants.
  - `ConnectionButton` — `window.location` → `{NEXT_PUBLIC_API_URL}/api/v1/connections/github/authorize`.
  - `DisconnectDialog` — confirm modal; `useMutation` → `DELETE /api/v1/connections/github`
    (204) → invalidate `profile/me`; errors via toast.
  - `ConnectionStatus` / `SourceIcon` — status badge (ARIA) + per-provider icon.
- **State → endpoint map:** Connect → navigate to authorize; OAuth callback → backend
  exchanges + fetches synchronously + 302 back to `/connections` (or
  `FRONTEND_CONNECTIONS_REDIRECT`) → refetch `profile/me`; Disconnect (post-confirm) →
  `DELETE` → 204. The `refreshing` state + Refresh affordance are **defined but hidden**
  until the future refresh endpoint exists.
- **Reads `?error=`** query param to surface OAuth failures on the relevant card.

---

## 6. API contract — `GET /api/v1/profile/me` → `ProfileResponse`

```jsonc
{
  "user": { "name": "Aisha Verma" },   // headline is OPTIONAL — the API omits it when null (frontend types it `headline?: string | null`)
  "sources": [
    { "source": "GITHUB", "connected": true,  "lastRefreshedAt": "ISO" },
    { "source": "RESUME", "connected": false },
    { "source": "LEETCODE", "connected": false },
    { "source": "LINKEDIN", "connected": false },
    { "source": "X", "connected": false }
  ],
  "notable": [ { "text": "1,204 GitHub contributions in the last year", "source": "GITHUB" } ],
  "mostUsedSkills": [ { "skill": "TypeScript", "evidence": "GitHub 48%" } ],
  "atAGlance": [ "Most active in TypeScript and Python across 38 repos" ],
  "fragments": { "github": { /* §4 shape */ } },
  "provenance": [ { "source": "GITHUB", "fragmentHash": "sha256:...", "fetchedAt": "ISO" } ]
}
```

This mirrors the documented synthesis output contract's spirit (descriptive bullets +
evidence + provenance) so swapping `ProfileAssembler` for the real synthesis service is
a backend-only change. **No `score`/`rank`/comparative field anywhere** — and the
Connections UI must not introduce one either.

**Both `/profile` and `/connections` consume this same endpoint** (TanStack Query
`useQuery`); `/connections` additionally drives the mutation endpoints (authorize via
navigation, `DELETE` via `useMutation`). No `ProfileResponse` schema change for either page.

---

## 7. New configuration / env

**Backend** (`.env` + `application.properties`):
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_TOKEN_KEY` (base64-encoded 32-byte AES key)
- `FRONTEND_CONNECTIONS_REDIRECT` (default `{frontend}/connections`) — callback return target.
- A GitHub OAuth App registered with callback
  `http://localhost:8080/api/v1/connections/github/callback`.

**Frontend runtime env:** none beyond existing `NEXT_PUBLIC_API_URL`.

**Frontend tooling / dependencies** (scaffolding for the implementation plan — *not* run during design):
- `npx shadcn@latest init` → `components.json` (style `new-york`, base `slate`, cssVariables,
  config `tailwind.config.js`, css `app/globals.css`, alias `@/`, lucide). At the React-19
  peer-dep prompt choose **`--legacy-peer-deps`** (not `--force`); verify the lockfile after.
- Cherry-pick the **shell** primitives + components from `dashboard-01` (sidebar, sheet,
  tooltip, separator, dropdown-menu, avatar, button, etc.) — **without** the data-table block.
- `npx shadcn@latest add chart` → installs **recharts** + `ChartContainer`/`ChartTooltip`.
- `npx shadcn@latest add card button dialog badge` + a toast (`sonner`) for disconnect errors.
- Net new deps: a handful of `@radix-ui/*` (sidebar/dialog/dropdown/etc.), `recharts`, `sonner`.
  **Already present, do not re-add:** `@tanstack/react-query`, `class-variance-authority`,
  `clsx`, `tailwind-merge`, `tailwindcss-animate`, `lucide-react`.
- After scaffolding, **manually back-port** `dashboard-01`'s `--sidebar-*` tokens into the
  existing HSL `:root`/`.dark` blocks in `globals.css` + mirror in `tailwind.config.js`
  (the block ships v4/Tailwind-4 tokens; this repo is Tailwind 3 — see Risks).

---

## 8. Risks / flagged items (per CLAUDE.md stop-and-ask)

- **Token storage + OAuth scope expansion** — security-relevant; approved during
  brainstorming (AES-GCM env key, `read:user`). KMS upgrade path noted for prod.
- **Tutorial-repo heuristic** — deferred; product IP, needs human review before shipping.
- **Bands without synthesis** — rule-based stand-in is explicitly temporary; isolated
  behind `ProfileAssembler` so it can't leak into the synthesis contract.
- Cookies/`secure` flags and prod hardening tracked separately from this slice.
- **Tailwind-3 vs `dashboard-01`-v4 tokens** *(biggest integration risk)* — the block ships
  v4/Tailwind-4 `--sidebar-*` tokens (oklch/`@theme`); on Tailwind 3.4 they must be
  hand-back-ported into the HSL `:root`/`.dark` blocks + mirrored in `tailwind.config.js`,
  or the sidebar renders with missing colors. Needs a verification build.
- **React-19 peer deps** — install with `--legacy-peer-deps`, not `--force`; verify lockfile.
- **Auth gating on layout swap** — replacing the `RequireAuth` stub layout with the shell
  must keep client-side gating (`RequireAuth` wraps the shell).
- **Broken-nav impression** — `/dashboard` is a stub; render a placeholder, not a 404.
- **Redundant connections stubs** — `profile/connections` + `onboarding/connections` must
  become redirects, not parallel implementations.
- **Hidden refresh affordance** — the `refreshing` state references a refresh endpoint that
  is not built; the Refresh button stays hidden so it can't 404.

---

## 9. Testing approach

- **TokenCipher** — round-trip encrypt/decrypt; tampered ciphertext fails.
- **GitHubCollector** — map a recorded GraphQL JSON fixture → fragment; hash stability
  (same input → same hash; changed input → new hash).
- **ProfileAssembler** — given a GitHub-only fragment set, asserts notable/skills output
  and **no scoring fields**.
- **ProfileController** — `GET /me` shape; unconnected sources reported correctly.
- **Frontend** — `useProfile` rendering of connected vs. placeholder source states.
  - App shell renders sidebar with Dashboard/Profile/Connections links; `NavUser` bound to session.
  - Connections page renders one `ProviderCard` per source with the correct state machine
    (not-connected/connecting/connected/error/refreshing); Connect navigates to
    `{API}/api/v1/connections/github/authorize`; Disconnect → `DisconnectDialog` → `DELETE`
    → state flips to not-connected.
  - Chart components render from fragment data and assert **no scoring/ranking labels**.
  - Playwright happy-path: sidebar nav → `/connections` → Connect button navigates to the
    authorize endpoint (extends the existing auth happy-path).
