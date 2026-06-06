import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export type ConnectionState = "not-connected" | "connected" | "error";

const LABELS: Record<ConnectionState, string> = {
  "not-connected": "Not connected",
  connected: "Connected",
  error: "Error",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <Badge
      role="status"
      aria-label={`Connection status: ${LABELS[state]}`}
      variant={
        state === "connected"
          ? "default"
          : state === "error"
            ? "destructive"
            : "secondary"
      }
      className={cn(state === "not-connected" && "text-muted-foreground")}
    >
      {LABELS[state]}
    </Badge>
  );
}
