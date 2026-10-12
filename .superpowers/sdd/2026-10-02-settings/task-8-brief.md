### Task 8: Web settings data layer (`features/settings`)

**Files:**
- Create: `apps/web/lib/constants/settings/index.ts`
- Modify: `apps/web/lib/constants/shared/routes.ts` (`settings` group)
- Create: `apps/web/features/settings/types.ts`, `api.ts`, `merge.ts`, `hooks.ts`, `device-prefs.ts`, `download.ts`, `index.ts`
- Test: `apps/web/features/settings/merge.test.ts`, `hooks.test.tsx`, `device-prefs.test.ts` (+ fixture `__fixtures__/preferences.ts`)

**Interfaces:**
- Consumes: generated schemas (Task 7); `apiFetch`, `ApiFetchError`; `useAuth`; `AUTH_ENDPOINTS.forgotPassword`, `AUTH_ENDPOINTS.resendVerification`; `PROFILE_QUERY_KEYS.profile`.
- Produces (all exported from `@/features/settings`):
  - Types: `Preferences`, `PreferencesPatch`, `AccountExport`, `DeleteAccountRequest`
  - Pure helpers: `applyPatch(prefs, patch): Preferences`, `downloadJson(data, filename)`, `exportFilename(date?: Date): string`
  - Query and mutation hooks:
    - `usePreferences()` → `UseQueryResult<Preferences>`
    - `useUpdatePreferences()` → mutation taking a `PreferencesPatch`
    - `useUpdateName()` → mutation taking a `string`
    - `useRevokeSessions()`, `useExportData()`, `useDeleteAccount()`
    - `useSendPasswordLink()` → mutation taking an email `string`
    - `useResendVerification()`
  - Device prefs:
    - `type DevicePrefs = { reducedMotion: "system" | "reduce"; textSize: "default" | "large" }`
    - `DEVICE_PREFS_KEY = "iq-device-prefs"`
    - `readDevicePrefs()`, `writeDevicePrefs(patch)`, `applyDevicePrefs(prefs, root?)`, `useDevicePrefs()` → `[DevicePrefs, (patch) => void]`
    - `DEVICE_PREFS_EVENT = "iq-device-prefs"`
  - Constants and routes:
    - `SETTINGS_ENDPOINTS`, `SETTINGS_QUERY_KEYS`
    - `ROUTES.settings.{root, account, preferences, interview, notifications, privacy, accessibility, billing}`

- [ ] **Step 1: Constants**

`apps/web/lib/constants/settings/index.ts`:

```ts
/** Settings module constants. Import per group: `import { SETTINGS_ENDPOINTS } from "@/lib/constants/settings";` */

export const SETTINGS_ENDPOINTS = {
  me: "/api/v1/users/me", // PATCH name, DELETE account
  preferences: "/api/v1/users/me/preferences", // GET, PATCH
  revokeSessions: "/api/v1/users/me/sessions/revoke", // POST
  export: "/api/v1/users/me/export", // GET
} as const;

export const SETTINGS_QUERY_KEYS = {
  preferences: ["settings", "preferences"] as const,
  /** Shared with lib/hooks/useCurrentUser. */
  currentUser: ["auth", "me"] as const,
} as const;
```

`apps/web/lib/constants/shared/routes.ts`: replace the `settings` group with:

```ts
  settings: {
    root: "/settings",
    account: "/settings/account",
    preferences: "/settings/preferences",
    interview: "/settings/interview",
    notifications: "/settings/notifications",
    privacy: "/settings/privacy",
    accessibility: "/settings/accessibility",
    billing: "/settings/billing",
  },
```

- [ ] **Step 2: Write the failing tests**

`apps/web/features/settings/__fixtures__/preferences.ts` (test fixture, not a test file):

```ts
import type { Preferences } from "../types";

/** The API defaults as a resolved `Preferences` — the starting cache in settings tests. */
export const PREFS: Preferences = {
  locale: { appLanguage: "en", timezone: null, dateFormat: "DD/MM/YYYY", timeFormat: "12h", weekStart: "monday" },
  interview: { language: "en", voice: "neutral", pace: "normal", captions: true, showTimer: true, deviceCheck: true, reminderLead: "1h" },
  notifications: {
    emailPaused: false,
    email: { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: true, productUpdates: false },
    inApp: { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: false, productUpdates: false },
  },
  privacy: { leaderboardVisibility: "anonymous", shareWithCollege: false, partnerDiscovery: false, improveWithMyData: false },
  updatedAt: null,
};
```

`apps/web/features/settings/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PREFS } from "./__fixtures__/preferences";
import { applyPatch } from "./merge";

describe("applyPatch", () => {
  it("changes only the patched leaves", () => {
    const next = applyPatch(PREFS, { interview: { pace: "faster" }, notifications: { email: { productUpdates: true } } });
    expect(next.interview).toEqual({ ...PREFS.interview, pace: "faster" });
    expect(next.notifications.email).toEqual({ ...PREFS.notifications.email, productUpdates: true });
    expect(next.notifications.inApp).toEqual(PREFS.notifications.inApp);
    expect(next.notifications.emailPaused).toBe(false);
    expect(next.locale).toEqual(PREFS.locale);
  });

  it("sets emailPaused and a null timezone", () => {
    const withZone = applyPatch(PREFS, { locale: { timezone: "Asia/Kolkata" } });
    const next = applyPatch(withZone, { locale: { timezone: null }, notifications: { emailPaused: true } });
    expect(next.locale.timezone).toBeNull();
    expect(next.notifications.emailPaused).toBe(true);
  });

  it("does not mutate its input", () => {
    applyPatch(PREFS, { privacy: { shareWithCollege: true } });
    expect(PREFS.privacy.shareWithCollege).toBe(false);
  });
});
```

`apps/web/features/settings/hooks.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SETTINGS_QUERY_KEYS } from "@/lib/constants/settings";
import { PREFS } from "./__fixtures__/preferences";

const api = vi.hoisted(() => ({ updatePreferences: vi.fn() }));
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), updatePreferences: api.updatePreferences }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => ({ isAuthenticated: true, logout: vi.fn() }) }));

import { useUpdatePreferences } from "./hooks";

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(SETTINGS_QUERY_KEYS.preferences, PREFS);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

describe("useUpdatePreferences", () => {
  beforeEach(() => api.updatePreferences.mockReset());

  it("applies the patch optimistically and rolls back on error", async () => {
    let reject!: (e: Error) => void;
    api.updatePreferences.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    act(() => result.current.mutate({ interview: { pace: "faster" } }));
    await waitFor(() => expect(qc.getQueryData<typeof PREFS>(SETTINGS_QUERY_KEYS.preferences)?.interview.pace).toBe("faster"));

    await act(async () => reject(new Error("nope")));
    await waitFor(() => expect(qc.getQueryData<typeof PREFS>(SETTINGS_QUERY_KEYS.preferences)?.interview.pace).toBe("normal"));
  });

  it("keeps a second in-flight toggle when the first save resolves", async () => {
    const resolvers: ((v: typeof PREFS) => void)[] = [];
    api.updatePreferences.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    act(() => result.current.mutate({ interview: { captions: false } }));
    act(() => result.current.mutate({ interview: { showTimer: false } }));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // The first response only knows about the first change.
    await act(async () => resolvers[0]!({ ...PREFS, interview: { ...PREFS.interview, captions: false } }));
    const mid = qc.getQueryData<typeof PREFS>(SETTINGS_QUERY_KEYS.preferences)!;
    expect(mid.interview.showTimer).toBe(false);
    expect(mid.interview.captions).toBe(false);

    await act(async () => resolvers[1]!({ ...PREFS, interview: { ...PREFS.interview, captions: false, showTimer: false } }));
    const end = qc.getQueryData<typeof PREFS>(SETTINGS_QUERY_KEYS.preferences)!;
    expect(end.interview).toMatchObject({ captions: false, showTimer: false });
  });
});
```

`apps/web/features/settings/device-prefs.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { applyDevicePrefs, DEVICE_PREFS_KEY, readDevicePrefs, writeDevicePrefs } from "./device-prefs";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.text;
});

describe("device prefs", () => {
  it("defaults when nothing (or garbage) is stored", () => {
    expect(readDevicePrefs()).toEqual({ reducedMotion: "system", textSize: "default" });
    localStorage.setItem(DEVICE_PREFS_KEY, "{not json");
    expect(readDevicePrefs()).toEqual({ reducedMotion: "system", textSize: "default" });
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify({ reducedMotion: "allow", textSize: "huge" }));
    expect(readDevicePrefs()).toEqual({ reducedMotion: "system", textSize: "default" });
  });

  it("writes, persists and applies attributes on <html>", () => {
    writeDevicePrefs({ reducedMotion: "reduce", textSize: "large" });
    expect(readDevicePrefs()).toEqual({ reducedMotion: "reduce", textSize: "large" });
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(document.documentElement.dataset.text).toBe("large");
  });

  it("removes the attributes for the defaults", () => {
    applyDevicePrefs({ reducedMotion: "reduce", textSize: "large" });
    applyDevicePrefs({ reducedMotion: "system", textSize: "default" });
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(document.documentElement.dataset.text).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/web exec vitest run features/settings`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

`apps/web/features/settings/types.ts`:

```ts
import type { components } from "@/lib/api-client/generated/schema";

export type Preferences = components["schemas"]["Preferences"];
export type PreferencesPatch = components["schemas"]["PreferencesPatch"];
export type DeleteAccountRequest = components["schemas"]["DeleteAccountRequest"];
export type AccountExport = components["schemas"]["AccountExport"];
```

`apps/web/features/settings/api.ts`:

```ts
import { apiFetch } from "@/lib/api-client/client";
import { AUTH_ENDPOINTS } from "@/lib/constants/shared";
import { SETTINGS_ENDPOINTS } from "@/lib/constants/settings";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import type { AccountExport, DeleteAccountRequest, Preferences, PreferencesPatch } from "./types";

export function getPreferences(): Promise<Preferences> {
  return apiFetch<Preferences>(SETTINGS_ENDPOINTS.preferences);
}

export function updatePreferences(patch: PreferencesPatch): Promise<Preferences> {
  return apiFetch<Preferences>(SETTINGS_ENDPOINTS.preferences, { method: "PATCH", json: patch });
}

export function updateName(name: string): Promise<CurrentUser> {
  return apiFetch<CurrentUser>(SETTINGS_ENDPOINTS.me, { method: "PATCH", json: { name } });
}

/** Log out of all devices (204). The caller then clears the local session. */
export function revokeSessions(): Promise<void> {
  return apiFetch<void>(SETTINGS_ENDPOINTS.revokeSessions, { method: "POST" });
}

export function exportData(): Promise<AccountExport> {
  return apiFetch<AccountExport>(SETTINGS_ENDPOINTS.export);
}

export function deleteAccount(body: DeleteAccountRequest): Promise<void> {
  return apiFetch<void>(SETTINGS_ENDPOINTS.me, { method: "DELETE", json: body });
}

/** The forgot-password flow doubles as "change / set a password" from Settings. */
export function sendPasswordLink(email: string): Promise<void> {
  return apiFetch<void>(AUTH_ENDPOINTS.forgotPassword, { method: "POST", json: { email } });
}

export function resendVerification(): Promise<void> {
  return apiFetch<void>(AUTH_ENDPOINTS.resendVerification, { method: "POST" });
}
```

`apps/web/features/settings/merge.ts`:

```ts
import type { Preferences, PreferencesPatch } from "./types";

/** Optimistic update: the server's leaf-by-leaf merge, done locally. Never mutates `prefs`. */
export function applyPatch(prefs: Preferences, patch: PreferencesPatch): Preferences {
  const n = patch.notifications;
  return {
    ...prefs,
    locale: { ...prefs.locale, ...patch.locale },
    interview: { ...prefs.interview, ...patch.interview },
    notifications: {
      emailPaused: n?.emailPaused ?? prefs.notifications.emailPaused,
      email: { ...prefs.notifications.email, ...n?.email },
      inApp: { ...prefs.notifications.inApp, ...n?.inApp },
    },
    privacy: { ...prefs.privacy, ...patch.privacy },
  };
}
```

`apps/web/features/settings/download.ts`:

```ts
/** `interviewiq-export-2026-10-02.json` (the API names its attachment the same way). */
export function exportFilename(date: Date = new Date()): string {
  return `interviewiq-export-${date.toISOString().slice(0, 10)}.json`;
}

/** Save `data` as a pretty-printed JSON file via a temporary object URL. */
export function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

`apps/web/features/settings/device-prefs.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

/** Settings → Accessibility. This device only (localStorage), applied as attributes on <html>. */
export interface DevicePrefs {
  reducedMotion: "system" | "reduce";
  textSize: "default" | "large";
}

export const DEVICE_PREFS_KEY = "iq-device-prefs";
export const DEVICE_PREFS_EVENT = "iq-device-prefs";
export const DEFAULT_DEVICE_PREFS: DevicePrefs = { reducedMotion: "system", textSize: "default" };

export function readDevicePrefs(): DevicePrefs {
  try {
    const raw = window.localStorage.getItem(DEVICE_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<DevicePrefs>) : {};
    return {
      reducedMotion: parsed.reducedMotion === "reduce" ? "reduce" : "system",
      textSize: parsed.textSize === "large" ? "large" : "default",
    };
  } catch {
    return DEFAULT_DEVICE_PREFS;
  }
}

export function applyDevicePrefs(prefs: DevicePrefs, root: HTMLElement = document.documentElement): void {
  if (prefs.reducedMotion === "reduce") root.dataset.motion = "reduce";
  else delete root.dataset.motion;
  if (prefs.textSize === "large") root.dataset.text = "large";
  else delete root.dataset.text;
}

export function writeDevicePrefs(patch: Partial<DevicePrefs>): DevicePrefs {
  const next = { ...readDevicePrefs(), ...patch };
  try {
    window.localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): still apply for this page view.
  }
  applyDevicePrefs(next);
  window.dispatchEvent(new CustomEvent<DevicePrefs>(DEVICE_PREFS_EVENT, { detail: next }));
  return next;
}

/** The current device prefs plus a setter; stays in sync across components and tabs. */
export function useDevicePrefs(): [DevicePrefs, (patch: Partial<DevicePrefs>) => void] {
  const [prefs, setPrefs] = useState<DevicePrefs>(DEFAULT_DEVICE_PREFS);
  useEffect(() => {
    setPrefs(readDevicePrefs());
    const sync = () => setPrefs(readDevicePrefs());
    window.addEventListener(DEVICE_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DEVICE_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((patch: Partial<DevicePrefs>) => setPrefs(writeDevicePrefs(patch)), []);
  return [prefs, update];
}
```

`apps/web/features/settings/hooks.ts`:

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiFetchError } from "@/lib/api-client/errors";
import { useAuth } from "@/lib/auth/AuthProvider";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";
import { SETTINGS_QUERY_KEYS } from "@/lib/constants/settings";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import {
  deleteAccount,
  exportData,
  getPreferences,
  resendVerification,
  revokeSessions,
  sendPasswordLink,
  updateName,
  updatePreferences,
} from "./api";
import { downloadJson, exportFilename } from "./download";
import { applyPatch } from "./merge";
import type { DeleteAccountRequest, Preferences, PreferencesPatch } from "./types";

const PREFS_KEY = SETTINGS_QUERY_KEYS.preferences;

export function usePreferences() {
  const { isAuthenticated } = useAuth();
  return useQuery<Preferences>({ queryKey: PREFS_KEY, queryFn: getPreferences, enabled: isAuthenticated, staleTime: 5 * 60_000 });
}

/**
 * Autosave one setting: optimistic, rolled back on failure. While several saves are in flight,
 * an earlier response doesn't overwrite later optimistic changes — only the last one to finish
 * writes the server's state into the cache.
 */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: PREFS_KEY,
    mutationFn: (patch: PreferencesPatch) => updatePreferences(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const previous = qc.getQueryData<Preferences>(PREFS_KEY);
      if (previous) qc.setQueryData<Preferences>(PREFS_KEY, applyPatch(previous, patch));
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(PREFS_KEY, ctx.previous);
      toast.error("Couldn't save that change. Please try again.");
    },
    onSuccess: (saved) => {
      if (qc.isMutating({ mutationKey: PREFS_KEY }) <= 1) qc.setQueryData(PREFS_KEY, saved);
      toast.success("Saved", { id: "settings-saved" });
    },
  });
}

export function useUpdateName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => updateName(name),
    onSuccess: (user) => {
      qc.setQueryData<CurrentUser>(SETTINGS_QUERY_KEYS.currentUser, user);
      void qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.profile });
      toast.success("Name updated");
    },
    onError: () => toast.error("Couldn't update your name. Please try again."),
  });
}

/** Revoke every session server-side, then drop this one locally (the caller navigates to /login). */
export function useRevokeSessions() {
  const { logout } = useAuth();
  return useMutation({
    mutationFn: async () => {
      await revokeSessions();
      await logout();
    },
    onError: () => toast.error("Couldn't log out of all devices. Please try again."),
  });
}

export function useExportData() {
  return useMutation({
    mutationFn: exportData,
    onSuccess: (data) => {
      downloadJson(data, exportFilename());
      toast.success("Your data is downloading");
    },
    onError: () => toast.error("Couldn't prepare your export. Please try again."),
  });
}

/** Errors stay with the caller: the dialog renders them inline by code. */
export function useDeleteAccount() {
  return useMutation({ mutationFn: (body: DeleteAccountRequest) => deleteAccount(body) });
}

export function useSendPasswordLink() {
  return useMutation({
    mutationFn: (email: string) => sendPasswordLink(email),
    onSuccess: (_v, email) => toast.success(`Check your inbox — we sent a link to ${email}.`),
    onError: (err) =>
      toast.error(err instanceof ApiFetchError && err.code === "rate_limited" ? "Too many requests — try again in a little while." : "Couldn't send the link. Please try again."),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: resendVerification,
    onSuccess: () => toast.success("Verification link sent."),
    onError: (err) =>
      toast.error(err instanceof ApiFetchError && err.code === "rate_limited" ? "Too many requests — try again in a little while." : "Couldn't send the link. Please try again."),
  });
}
```

`apps/web/features/settings/index.ts`:

```ts
export * from "./types";
export { applyPatch } from "./merge";
export { downloadJson, exportFilename } from "./download";
export {
  DEFAULT_DEVICE_PREFS,
  DEVICE_PREFS_EVENT,
  DEVICE_PREFS_KEY,
  applyDevicePrefs,
  readDevicePrefs,
  useDevicePrefs,
  writeDevicePrefs,
  type DevicePrefs,
} from "./device-prefs";
export {
  useDeleteAccount,
  useExportData,
  usePreferences,
  useResendVerification,
  useRevokeSessions,
  useSendPasswordLink,
  useUpdateName,
  useUpdatePreferences,
} from "./hooks";
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @interviewiq/web exec vitest run features/settings`
Expected: PASS.

If the second hooks test fails at `mid`, check `isMutating` while `onSuccess` runs. In TanStack v5 the finishing mutation still counts as pending there, so `<= 1` means "I am the last one". If the installed version reports 0, the guard still holds. If it reports 2 for both, log the count once to confirm, then change the comparison to match.

- [ ] **Step 6: Typecheck + full web suite**

Run: `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web exec vitest run`
Expected: PASS.

`ApiFetchError` must expose `.code`. `VerifyEmailBanner` already uses `err.code`, so it does.

---

# Phase B — settings UI (start only after `interviewiq-50` reports HUD Tasks 8 + 12 done)

Before each task: re-read every file listed under **Modify**, since the HUD sweep may have changed it. Import HUD primitives only from `@/components/hud`:
- `HudCard({ title?, meta?, action?, footer?, notch?, tone?, as?, titleAs?, active?, spotlight?, className?, headerClassName?, bodyClassName?, "aria-label"?, children })`
- `HudEmpty({ title, hint?, tag?, children? })`
- `Readout({ label, value, unit?, note?, size? })`
- `StatusDot({ state: "live"|"active"|"idle"|"warn"|"error", label?, srLabel? })`
- `Kbd({ children, label?, size? })`

