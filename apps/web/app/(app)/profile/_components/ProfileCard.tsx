import * as React from "react";
import { Card, EmptyState } from "@/components/ds";

export interface ProfileCardProps {
  title: string;
  /** Quiet text under the title, e.g. "@asha". */
  meta?: React.ReactNode;
  /** Right-aligned control in the header row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A profile card (`Connected sources`, `Skills`): a hairline `Card` whose header pads itself and
 * whose body brings its own padding, so list rows can run edge to edge.
 */
export function ProfileCard({ title, meta, action, children, className }: ProfileCardProps) {
  return (
    <Card flush title={title} meta={meta} action={action} className={className} headerClassName="pb-2">
      {children}
    </Card>
  );
}

/** Quiet note for a card with nothing to show yet. */
export function CardEmpty({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <EmptyState orb={false} title={title} hint={hint} className="px-5 py-8">
      {children}
    </EmptyState>
  );
}
