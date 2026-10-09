/** Where the Highlight · Ask toolbar goes (all numbers in px, relative to the box it is positioned in). It sits above
 * the selection, but a selection on the first line of a panel has no room above it and the panel would cut the
 * toolbar off, so there it goes below. Sideways it stays inside the box. */
export const TOOLBAR_HEIGHT = 38
export const TOOLBAR_GAP = 6
export const TOOLBAR_HALF_WIDTH = 72

export type ToolbarPlacement = 'above' | 'below'

export function placeToolbar({ top, bottom, center, boxWidth, clipTop }: {
  /** The selection's top and bottom edges. */
  top: number
  bottom: number
  /** The horizontal middle of the selection. */
  center: number
  boxWidth: number
  /** The top edge of the visible area (the scrolling panel), where anything above is cut off. */
  clipTop: number
}): { top: number; left: number; placement: ToolbarPlacement } {
  const placement: ToolbarPlacement = top - clipTop >= TOOLBAR_HEIGHT + TOOLBAR_GAP ? 'above' : 'below'
  const left = boxWidth < 2 * TOOLBAR_HALF_WIDTH ? center : Math.min(Math.max(center, TOOLBAR_HALF_WIDTH), boxWidth - TOOLBAR_HALF_WIDTH)
  return { top: placement === 'above' ? top : bottom, left, placement }
}

/** The nearest ancestor that clips its content (a scrolling panel), or null. */
export function clippingAncestor(el: HTMLElement | null): HTMLElement | null {
  for (let e = el?.parentElement ?? null; e; e = e.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(e).overflowY)) return e
  }
  return null
}
