"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDisconnectGithub } from "@/features/profile";

export function DisconnectDialog({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const { mutate, isPending } = useDisconnectGithub();

  function handleConfirm() {
    mutate(undefined, {
      onSuccess: () => {
        setOpen(false);
        toast.success(`${label} disconnected`);
      },
      onError: () => {
        toast.error(`Could not disconnect ${label}. Please try again.`);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Disconnect</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {label}?</DialogTitle>
          <DialogDescription>
            This removes the connection and its synced data from your profile.
            You can reconnect any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
