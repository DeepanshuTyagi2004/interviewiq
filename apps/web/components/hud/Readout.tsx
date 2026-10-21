import { Stat, type StatProps } from "@/components/ds/Stat";

export type ReadoutProps = StatProps;

/** Shim: a Readout is a `ds/Stat`. */
export const Readout = Stat;
