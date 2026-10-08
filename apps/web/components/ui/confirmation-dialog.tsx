"use client";

import { useRef, useState } from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

export function ConfirmationDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", onConfirm, pending = false, destructive = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string;
  confirmLabel?: string; onConfirm: () => void | Promise<void>; pending?: boolean; destructive?: boolean;
}) {
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  return <Dialog open={open} onOpenChange={(next) => { if (!pending && !busy.current) onOpenChange(next); }}>
    <DialogContent onOpenAutoFocus={(event) => {
      event.preventDefault();
      cancelButton.current?.focus();
    }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter className="gap-2">
        <Button ref={cancelButton} variant="ghost" disabled={pending || working} onClick={() => { if (!busy.current) onOpenChange(false); }}>Cancel</Button>
        <Button variant={destructive ? "destructive" : "default"} disabled={pending || working} onClick={async () => {
          if (busy.current || pending) return;
          busy.current = true;
          setWorking(true);
          try { await onConfirm(); onOpenChange(false); } finally { busy.current = false; setWorking(false); }
        }}>{pending || working ? "Working…" : confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
