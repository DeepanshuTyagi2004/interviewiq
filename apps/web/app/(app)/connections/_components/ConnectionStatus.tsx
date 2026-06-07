import { cn } from "@/lib/utils/cn";

export type ConnectionState = "not-connected" | "connected" | "error";

const LABELS: Record<ConnectionState, string> = {
  "not-connected": "Not connected",
  connected: "Connected",
  error: "Error",
};

const DOT: Record<ConnectionState, string> = {
  "not-connected": "bg-muted-foreground/50",
  connected: "bg-green-500",
  error: "bg-destructive",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <span
      role="status"
      aria-label={`Connection status: ${LABELS[state]}`}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", DOT[state])}
      />
      {LABELS[state]}
    </span>
  );
}
