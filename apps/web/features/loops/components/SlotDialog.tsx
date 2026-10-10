"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCancelSession, useCreateSession, useMySessions, useRescheduleSession, type InterviewSession } from "@/features/interview";
import { bookingError } from "../errors";
import { slotAt, slotText } from "../slots";
import type { Loop } from "../types";
import { roundTypeLabel } from "../graph";
import { SlotPicker } from "./SlotPicker";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { MOCK_ROUND_MINUTES } from "@/lib/constants/interview";

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function SlotDialogBody({ title, description, confirmLabel, ignoreSessionId, pending, onConfirm, allowNow }: {
  title: string; description: string; confirmLabel: string; ignoreSessionId?: string; pending: boolean;
  onConfirm: (scheduledAt: string) => void; allowNow?: boolean;
}) {
  const sessions = useMySessions().data?.sessions ?? [];
  const [day, setDay] = useState<Date | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const slot = day && hour !== null ? slotAt(day, hour) : null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <SlotPicker day={day} hour={hour} onChange={(d, h) => { setDay(d); setHour(h); }} sessions={sessions} ignoreSessionId={ignoreSessionId} />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {allowNow ? (
          <Button variant="strong" disabled={pending} onClick={() => onConfirm(new Date(Date.now() + 60_000).toISOString())}>
            Start now
          </Button>
        ) : null}
        <Button disabled={!slot || pending} onClick={() => slot && onConfirm(slot.toISOString())}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {slot ? `${confirmLabel} ${slotText(slot)}` : confirmLabel}
        </Button>
      </div>
    </>
  );
}

/** Book one round of a confirmed loop into a free slot. */
export function BookRoundDialog({ loop, nodeId, onOpenChange }: { loop: Loop; nodeId: string | null; onOpenChange: (open: boolean) => void }) {
  const create = useCreateSession();
  const node = loop.graph.nodes.find((n) => n.id === nodeId);
  return (
    <Dialog open={nodeId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        {node && node.kind === "round" ? (
          <SlotDialogBody
            title={`Book ${node.name}`}
            description={`${loop.jd?.companyName ?? loop.name} · ${levelLabel(loop.level)} · ${roundTypeLabel(node.type)} · ${MOCK_ROUND_MINUTES} min`}
            confirmLabel="Book"
            allowNow
            pending={create.isPending}
            onConfirm={(scheduledAt) =>
              create.mutate(
                { ...(loop.jdId ? { jobDescriptionId: loop.jdId } : {}), loopId: loop.id, nodeId: node.id, scheduledAt, timezone: tz() },
                {
                  onSuccess: () => { toast.success("Round booked. We'll prepare your interviewer before the slot."); onOpenChange(false); },
                  onError: (err) => toast.error(bookingError(err)),
                },
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Move an upcoming interview to another free slot. */
export function RescheduleDialog({ session, onOpenChange }: { session: InterviewSession | null; onOpenChange: (open: boolean) => void }) {
  const reschedule = useRescheduleSession();
  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        {session ? (
          <SlotDialogBody
            title="Reschedule interview"
            description={`${session.companyName ?? session.company} · ${roundTypeLabel(session.roundType)}`}
            confirmLabel="Move to"
            ignoreSessionId={session.id}
            pending={reschedule.isPending}
            onConfirm={(scheduledAt) =>
              reschedule.mutate(
                { id: session.id, scheduledAt, timezone: tz() },
                {
                  onSuccess: () => { toast.success("Interview moved."); onOpenChange(false); },
                  onError: (err) => toast.error(bookingError(err)),
                },
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Cancel after a confirmation click. */
export function useCancelWithToast() {
  const cancel = useCancelSession();
  const [cancelId, setCancelId] = useState<string | null>(null);
  return {
    pending: cancel.isPending,
    cancel: setCancelId,
    confirmation: <ConfirmationDialog open={cancelId !== null} onOpenChange={(open) => { if (!open) setCancelId(null); }} title="Cancel this interview?" description="Its slot and track round will be freed." confirmLabel="Cancel interview" destructive pending={cancel.isPending} onConfirm={async () => {
      if (!cancelId) return;
      try { await cancel.mutateAsync(cancelId); toast.success("Interview cancelled."); } catch (error) { toast.error(bookingError(error)); }
    }} />,
  };
}
