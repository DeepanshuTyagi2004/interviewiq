/**
 * Which onboarding step the candidate was on, kept in sessionStorage so a refresh — or the full-page
 * GitHub OAuth round trip — lands them back on the same step. Per tab, cleared on finish.
 */
const STEP_KEY = "iq-onboarding-step";

export function readStep(stepCount: number): number | null {
  try {
    const raw = sessionStorage.getItem(STEP_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < stepCount ? n : null;
  } catch {
    return null;
  }
}

export function writeStep(step: number): void {
  try {
    sessionStorage.setItem(STEP_KEY, String(step));
  } catch {
    // storage unavailable — the wizard still works, it just won't resume after a reload
  }
}

export function clearStep(): void {
  try {
    sessionStorage.removeItem(STEP_KEY);
  } catch {
    // ignore
  }
}
