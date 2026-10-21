"use client";

import { useState } from "react";
import type { ReportQuestion } from "@/features/report";
import { FOCUS_RING } from "./styles";

type Code = NonNullable<ReportQuestion["code"]>;

const LOGIC_LABEL: Record<string, string> = {
  yes: "The logic works",
  syntax_only: "The logic works; only syntax slips",
  partly: "The logic partly works",
  no: "The logic doesn't work yet",
};

/** Collapsible "Your code": the code, the grader's trace per example, and syntax slips. */
export function CodeAnswer({ code }: { code: Code }) {
  const [open, setOpen] = useState(false);
  const trace = code.trace ?? [];
  const slips = code.syntaxSlips ?? [];
  return (
    <div className="mt-4 rounded-tile bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-tile px-4 py-2.5 text-left text-[13px] text-ink-2 transition-colors hover:text-ink ${FOCUS_RING}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        Your code{code.language ? ` (${code.language})` : ""}
      </button>
      {open ? (
        <div className="border-t border-line px-4 py-4">
          <pre className="m-0 max-h-[360px] overflow-auto rounded-xl bg-background p-3.5 shadow-ring font-mono text-[12.5px] leading-[1.55]">
            <code>{code.text}</code>
          </pre>
          {code.logicWorks ? <p className="m-0 mt-3 text-[13px] text-ink-2">{LOGIC_LABEL[code.logicWorks] ?? code.logicWorks}</p> : null}
          {trace.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-[12.5px]">
                <caption className="pb-1.5 text-left text-[12px] text-ink-3">The grader&apos;s trace of your code, one row per example</caption>
                <thead>
                  <tr className="text-ink-3">
                    <th scope="col" className="py-1 pr-3 font-normal">Example</th>
                    <th scope="col" className="py-1 pr-3 font-normal">Predicted</th>
                    <th scope="col" className="py-1 pr-3 font-normal">Expected</th>
                    <th scope="col" className="py-1 font-normal">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.map((t, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3 font-mono">{t.example}</td>
                      <td className="py-1.5 pr-3 font-mono">{t.predicted}</td>
                      <td className="py-1.5 pr-3 font-mono">{t.expected}</td>
                      <td className="py-1.5 font-mono" aria-label={t.matches ? "Matches" : "Does not match"}>
                        {t.matches ? "✓" : "✗"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {slips.length > 0 ? (
            <div className="mt-3">
              <p className="m-0 text-[12px] text-ink-3">Syntax slips</p>
              <ul className="m-0 mt-1 list-disc pl-5 text-[13px]">
                {slips.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
