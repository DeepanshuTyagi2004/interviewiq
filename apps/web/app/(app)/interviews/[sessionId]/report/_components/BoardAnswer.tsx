"use client";

import dynamic from "next/dynamic";
import { Component, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import "@excalidraw/excalidraw/index.css";
import type { ReportQuestion } from "@/features/report";
import { FOCUS_RING } from "./styles";

type Board = NonNullable<ReportQuestion["board"]>;

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-surface-2" />,
});

class ViewerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Elements (and files) of a saved scene, or null when it can't be drawn. */
function parseScene(scene: Board["scene"]): { elements: unknown[]; files: Record<string, unknown> } | null {
  if (!scene || typeof scene !== "object") return null;
  const elements = (scene as { elements?: unknown }).elements;
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const files = (scene as { files?: unknown }).files;
  return { elements, files: files && typeof files === "object" ? (files as Record<string, unknown>) : {} };
}

/** The final whiteboard, read-only, beside the grader's notes; the text summary when there is no drawable scene. */
export function BoardAnswer({ board }: { board: Board }) {
  const [open, setOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const parsed = parseScene(board.scene);
  const notes = board.notes ?? [];
  const summary = board.summary ? <p className="m-0 text-[13.5px] leading-[1.55]">{board.summary}</p> : null;
  return (
    <div className="mt-4 rounded-tile bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-tile px-4 py-2.5 text-left text-[13px] text-ink-2 transition-colors hover:text-ink ${FOCUS_RING}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        Your diagram
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-line px-4 py-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {parsed ? (
              <ViewerBoundary fallback={summary}>
                <div data-testid="board-viewer" className="h-[360px] overflow-hidden rounded-xl bg-background shadow-ring">
                  <Excalidraw
                    viewModeEnabled
                    zenModeEnabled
                    theme={resolvedTheme === "dark" ? "dark" : "light"}
                    initialData={{
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      elements: parsed.elements as any,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      files: parsed.files as any,
                      scrollToContent: true,
                    }}
                  />
                </div>
              </ViewerBoundary>
            ) : (
              summary
            )}
          </div>
          {notes.length > 0 ? (
            <div className="min-w-0">
              <p className="m-0 text-[12px] text-ink-3">Grader&apos;s notes</p>
              <ul className="m-0 mt-1 list-disc pl-5 text-[13px] leading-[1.55]">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
