const HIGHLIGHT = "iq-turn-highlight";
const HIGHLIGHT_MS = 2000;

/** Scroll to a transcript turn (`#turn-<id>`) and highlight it for 2 s. No-op when the turn is not on the page. */
export function jumpToTurn(turnId: number | string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`turn-${turnId}`);
  if (!el) return;
  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  el.classList.add(HIGHLIGHT, "bg-brand/10", "ring-1", "ring-brand/40");
  window.setTimeout(() => el.classList.remove(HIGHLIGHT, "bg-brand/10", "ring-1", "ring-brand/40"), HIGHLIGHT_MS);
}
