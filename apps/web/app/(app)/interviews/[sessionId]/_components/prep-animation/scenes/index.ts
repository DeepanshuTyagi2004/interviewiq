import { architect } from "./architect";
import { cardSorter } from "./cardSorter";
import { noteTaker } from "./noteTaker";
import { reader } from "./reader";
import type { Scene } from "./types";
import { warmUp } from "./warmUp";

/** The chapters, in play order; the player starts at a random one and loops through the rest. */
export const SCENES: Scene[] = [reader, cardSorter, noteTaker, architect, warmUp];

export type { Scene } from "./types";
