import { r } from "./motion";

/**
 * Writes one frame straight to the SVG: scenes name their animated elements with `data-part` and set
 * attributes each frame, without a React render per frame. Unchanged values are skipped.
 */
export interface Stage {
  set(part: string, attr: string, value: string | number): void;
  text(part: string, value: string): void;
}

export function createStage(root: Element): Stage {
  const els = new Map<string, Element | null>();
  const last = new Map<string, string>();
  const el = (part: string) => {
    let e = els.get(part);
    if (e === undefined) {
      e = root.querySelector(`[data-part="${part}"]`);
      els.set(part, e);
    }
    return e;
  };
  return {
    set(part, attr, value) {
      const e = el(part);
      if (!e) return;
      const v = typeof value === "number" ? String(r(value)) : value;
      const key = `${part}|${attr}`;
      if (last.get(key) === v) return;
      last.set(key, v);
      e.setAttribute(attr, v);
    },
    text(part, value) {
      const e = el(part);
      if (e && e.textContent !== value) e.textContent = value;
    },
  };
}
