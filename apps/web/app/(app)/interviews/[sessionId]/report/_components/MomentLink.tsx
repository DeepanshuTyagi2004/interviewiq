"use client";

import { jumpToTurn } from "./jumpToTurn";
import { PILL_BUTTON } from "./styles";

/** "↗" button that scrolls to a transcript turn and highlights it. */
export function MomentLink({ turnId, label = "Jump to moment" }: { turnId: number; label?: string }) {
  return (
    <button
      type="button"
      aria-label={`${label} ${turnId}`}
      onClick={() => jumpToTurn(turnId)}
      className={`${PILL_BUTTON} h-5 px-1.5 font-mono text-[11px]`}
    >
      ↗
    </button>
  );
}
