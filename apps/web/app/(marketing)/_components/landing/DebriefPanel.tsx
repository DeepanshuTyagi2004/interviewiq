import { cn } from "@/lib/utils/cn";
import { MonoPill } from "@/components/patterns";
import { DEBRIEF_DIFF, LEARN_NEXT } from "./content";

/** "Debrief" illustration: the round score and a diff of the answer against a strong one. */
export function DebriefPanel() {
  return (
    <div className="iq-float w-full max-w-[460px] overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line px-5 py-[18px]">
        <span data-count="74" className="text-[48px] font-semibold leading-none tracking-[-0.05em]">
          74
        </span>
        <span className="text-[12.5px] text-faint">/ 100 · pass mark 70</span>
        <MonoPill tone="brand" className="ml-auto px-2 tracking-[0.06em]">
          PASSED
        </MonoPill>
      </div>
      <div className="py-2.5 font-mono text-xs leading-[1.95]">
        {DEBRIEF_DIFF.map(([sign, text, kind]) => {
          const Text = kind === "del" ? "del" : kind === "add" ? "ins" : "span";
          return (
            <div
              key={text}
              className={cn(
                "grid grid-cols-[30px_minmax(0,1fr)] pl-3.5 pr-5",
                kind === "add" && "bg-surface text-foreground",
                kind === "del" && "text-faint-2",
                kind === "ctx" && "text-muted-foreground",
              )}
            >
              <span aria-hidden className="text-faint-2">
                {sign}
              </span>
              <Text className={cn("truncate no-underline", kind === "del" && "line-through")}>{text}</Text>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-3.5">
        <span className="mr-1 text-xs text-faint">Learn next</span>
        {LEARN_NEXT.map((topic) => (
          <span key={topic} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium">
            {topic}
          </span>
        ))}
      </div>
    </div>
  );
}
