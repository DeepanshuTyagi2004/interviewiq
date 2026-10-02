"use client";

import dynamic from "next/dynamic";
import type { ResearchItem } from "@/features/research";

// react-flow reads layout/ResizeObserver APIs; client-only, like the agent pipeline canvas.
const GraphMiniMapInner = dynamic(() => import("./GraphMiniMapInner"), {
  ssr: false,
  loading: () => <div data-motion className="h-14 animate-pulse rounded-md bg-panel" />,
});

/** The company's LangGraph as a strip of nodes coloured by progress; the running node pulses. */
export function GraphMiniMap({ item }: { item: ResearchItem }) {
  return <GraphMiniMapInner item={item} />;
}
