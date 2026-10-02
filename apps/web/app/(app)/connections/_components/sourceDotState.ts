import type { DotState } from "@/components/hud";

/** The states a source row's dot can take. */
export type SourceDotState = Extract<DotState, "error" | "live" | "active" | "idle">;

/**
 * A source row's status dot, from what the row already knows. An error wins over a sync in
 * flight, which wins over a steady connection. `live` (the only pulsing state) means a sync or
 * import is really running right now.
 */
export function sourceDotState({
  connected,
  syncing,
  error,
}: {
  connected: boolean;
  syncing: boolean;
  error: boolean;
}): SourceDotState {
  if (error) return "error";
  if (syncing) return "live";
  if (connected) return "active";
  return "idle";
}

/** Screen-reader text for each dot state (the dot itself is colour only). */
export const SOURCE_DOT_LABEL: Record<SourceDotState, string> = {
  active: "Connected",
  live: "Syncing",
  error: "Sync error",
  idle: "Not connected",
};
