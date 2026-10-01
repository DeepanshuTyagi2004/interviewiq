"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Remove" for a catalogue company, behind a confirm dialog — removal also drops its JDs, so it
 * must never happen on a single stray click.
 */
export function RemoveCompanyButton({
  company,
  jdCount,
  pending,
  onConfirm,
}: {
  company: string;
  jdCount: number;
  pending: boolean;
  /** Runs the removal; call `done` once it succeeds so the dialog closes. */
  onConfirm: (done: () => void) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={pending}
          aria-label={`Remove ${company}`}
        >
          <Trash2 aria-hidden /> <span className="hidden sm:inline">Remove</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {company}?</DialogTitle>
          <DialogDescription>
            This removes the company and its {jdCount} {jdCount === 1 ? "JD" : "JDs"} from the catalogue. Candidates will
            no longer see them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(() => setOpen(false))} disabled={pending}>
            {pending ? "Removing…" : "Remove company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
