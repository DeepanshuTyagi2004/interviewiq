import * as React from "react";
import { HudCard, HudEmpty } from "@/components/hud";

export interface ProfileCardProps {
  title: string;
  /** Faint text beside the title, e.g. "@asha". */
  meta?: React.ReactNode;
  /** Right-aligned control in the header row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A profile card (`Connected sources`, `Preferences`): the shared HUD card with the title as its
 * mono header readout, `meta` after the leader line and `action` on the right.
 */
export function ProfileCard({ title, meta, action, children, className }: ProfileCardProps) {
  return (
    <HudCard title={title} meta={meta} action={action} className={className}>
      {children}
    </HudCard>
  );
}

/** Quiet note for a card with nothing to show yet. */
export function CardEmpty({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <HudEmpty title={title} hint={hint}>
      {children}
    </HudEmpty>
  );
}
