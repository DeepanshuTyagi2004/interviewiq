/**
 * The bars mascot: forms, moods and the geometry each form morphs to.
 * Reference: .superpowers/brainstorm/87486-1792346878/content/mascot-bars-v2.html (all coordinates
 * are in a 120 x 120 viewBox; the floor is y = 102).
 */

export type MascotForm = "trio" | "hopper" | "jelly" | "bloom";
export type MascotMood = "idle" | "listening" | "thinking" | "laughing" | "oops" | "speaking";

/** The morph loop: Trio, Hopper, Jelly, Bloom, then back to the Trio. */
export const MORPH_LOOP: MascotForm[] = ["trio", "hopper", "jelly", "bloom"];
/** How long a form is held, and how long the morph into the next one takes. */
export const FORM_HOLD_MS = 3600;
export const MORPH_MS = 900;

export function nextForm(f: MascotForm): MascotForm {
  const i = MORPH_LOOP.indexOf(f);
  return MORPH_LOOP[(i + 1) % MORPH_LOOP.length]!;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius. */
  r: number;
}

/** The three bars (left, middle, right), their six eyes (L and R of each bar) and the face offsets. */
export interface FormGeometry {
  bars: [Box, Box, Box];
  /** Eyes in order: bar 1 L, bar 1 R, bar 2 L, bar 2 R, bar 3 L, bar 3 R. */
  eyes: [Box, Box, Box, Box, Box, Box];
  /** Which bars show eyes (only the Trio shows all three). */
  eyeOn: [number, number, number];
  /** Vertical offset of the middle bar's face props (happy arcs, grin, X eyes) from the Trio's. */
  faceDy: number;
  /** The middle bar's top edge, for the bandage. */
  topY: number;
  mouth: { cy: number; rx: number; ry: number };
}

const eye = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, r: w / 2 });

export const FORM_GEOMETRY: Record<MascotForm, FormGeometry> = {
  trio: {
    bars: [
      { x: 22, y: 58, w: 20, h: 44, r: 10 },
      { x: 50, y: 26, w: 20, h: 76, r: 10 },
      { x: 78, y: 44, w: 20, h: 58, r: 10 },
    ],
    eyes: [eye(27, 68, 3.6, 6.5), eye(34, 68, 3.6, 6.5), eye(55, 38, 3.6, 6.5), eye(62, 38, 3.6, 6.5), eye(83, 54, 3.6, 6.5), eye(90, 54, 3.6, 6.5)],
    eyeOn: [1, 1, 1],
    faceDy: 0,
    topY: 26,
    mouth: { cy: 56, rx: 3.5, ry: 3 },
  },
  hopper: {
    bars: [
      { x: 34, y: 58, w: 14, h: 34, r: 7 },
      { x: 52, y: 34, w: 16, h: 58, r: 8 },
      { x: 72, y: 48, w: 14, h: 44, r: 7 },
    ],
    eyes: [eye(37, 66, 3, 5.5), eye(42, 66, 3, 5.5), eye(57, 44, 3.4, 6), eye(63, 44, 3.4, 6), eye(75, 56, 3, 5.5), eye(80, 56, 3, 5.5)],
    eyeOn: [0, 1, 0],
    faceDy: 6,
    topY: 34,
    mouth: { cy: 62, rx: 3.2, ry: 2.8 },
  },
  jelly: {
    bars: [
      { x: 22, y: 54, w: 17, h: 48, r: 8.5 },
      { x: 51, y: 26, w: 18, h: 76, r: 9 },
      { x: 81, y: 44, w: 17, h: 58, r: 8.5 },
    ],
    eyes: [eye(26, 64, 3.4, 6.5), eye(32, 64, 3.4, 6.5), eye(54, 40, 4, 7), eye(62, 40, 4, 7), eye(85, 54, 3.4, 6.5), eye(91, 54, 3.4, 6.5)],
    eyeOn: [0, 1, 0],
    faceDy: 2,
    topY: 26,
    mouth: { cy: 58, rx: 3.5, ry: 3 },
  },
  bloom: {
    bars: [
      { x: 27, y: 58, w: 14, h: 30, r: 7 },
      { x: 40, y: 24, w: 40, h: 78, r: 20 },
      { x: 79, y: 52, w: 14, h: 34, r: 7 },
    ],
    eyes: [eye(30, 64, 3, 5.5), eye(35, 64, 3, 5.5), eye(51, 44, 4.6, 8), eye(64, 44, 4.6, 8), eye(82, 58, 3, 5.5), eye(87, 58, 3, 5.5)],
    eyeOn: [0, 1, 0],
    faceDy: 6,
    topY: 24,
    mouth: { cy: 62, rx: 4.5, ry: 3.6 },
  },
};

/** Thinking: the bars collapse into three dots resting on the floor (any form). */
export const DOTS_GEOMETRY: FormGeometry = {
  bars: [
    { x: 24, y: 82, w: 20, h: 20, r: 10 },
    { x: 50, y: 82, w: 20, h: 20, r: 10 },
    { x: 76, y: 82, w: 20, h: 20, r: 10 },
  ],
  eyes: [eye(31, 90, 3, 5), eye(36, 90, 3, 5), eye(57, 90, 3, 5), eye(62, 90, 3, 5), eye(83, 90, 3, 5), eye(88, 90, 3, 5)],
  eyeOn: [0, 0, 0],
  faceDy: 52,
  topY: 82,
  mouth: { cy: 96, rx: 3, ry: 2.5 },
};

export function geometryFor(form: MascotForm, mood: MascotMood): FormGeometry {
  return mood === "thinking" ? DOTS_GEOMETRY : FORM_GEOMETRY[form];
}
