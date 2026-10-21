import { Chip } from "@/components/ds";
import type { SyncStatus } from "@/features/profile";
import { PROFILE_SYNC_STATUS } from "@/lib/constants/profile";

/** Label and look per sync state. The row's own status dot carries the pulse, so chips have none. */
const SYNC_CHIP: Record<SyncStatus, { label: string; tone: "default" | "outline"; className?: string }> = {
  [PROFILE_SYNC_STATUS.syncing]: { label: "Syncing", tone: "default" },
  [PROFILE_SYNC_STATUS.synced]: { label: "Synced", tone: "default" },
  [PROFILE_SYNC_STATUS.failed]: { label: "Sync failed", tone: "default", className: "bg-destructive/10 text-destructive" },
  [PROFILE_SYNC_STATUS.degraded]: { label: "Limited data", tone: "outline" },
};

/** The status chip for a source's sync: Syncing, Synced, Sync failed or Limited data. */
export function SyncChip({ status }: { status: SyncStatus }) {
  const chip = SYNC_CHIP[status];
  return (
    <Chip tone={chip.tone} className={chip.className}>
      {chip.label}
    </Chip>
  );
}

/** A failed connect (not a failed sync). */
export function ErrorChip() {
  return <Chip className="bg-destructive/10 text-destructive">Error</Chip>;
}
