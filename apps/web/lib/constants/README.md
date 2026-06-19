# Constants

Constants live here, organized by module. One `index.ts` per module.

## Convention

- One file per module: `lib/constants/<module>/index.ts`.
- Export grouped objects, `as const`, named `<MODULE>_<CATEGORY>` (UPPER_SNAKE):
  `PROFILE_ENDPOINTS`, `PROFILE_QUERY_KEYS`, `PROFILE_POLLING`, `PROFILE_SYNC_STATUS`.
- Standard categories: `_ENDPOINTS`, `_QUERY_KEYS`, `_POLLING`, `_SYNC_STATUS`.
  Add others as needed; keep the `<MODULE>_<CATEGORY>` shape.
- Derive types from constants (`type T = (typeof X)[keyof typeof X]`) — never
  duplicate the literal union in a separate `type`.
- `shared/` holds app-global constants (`APP_CONFIG`, `ROUTES`, auth endpoints)
  behind one barrel: `import { ROUTES } from "@/lib/constants/shared";`.
- Import feature constants per module: `import { PROFILE_POLLING } from "@/lib/constants/profile";`.

## Known follow-up

API path prefixes are inconsistent: profile/auth use `/api/v1/...`, while
`interview`/`jobs` use bare `/interviews`, `/jobs`. Values were relocated
verbatim during the initial migration; normalizing the prefix is a separate task.
