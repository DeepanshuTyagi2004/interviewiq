/** Shared class strings for the report's small pill controls (monochrome: ink on surface-2). */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** A quiet text-sized pill button ("why", "Moment ↗", filter chips when idle). */
export const PILL_BUTTON = `inline-flex items-center rounded-full bg-surface-2 text-ink-2 transition-colors duration-150 ease-iq hover:text-ink ${FOCUS_RING}`;

/** Row of a report card: hairline above every row, padding matching the flush card header. */
export const ROW = "border-t border-line px-5 py-4";
