import { Orb } from "@/components/ds";
import { Waveform } from "@/components/visualizations/Waveform";

/**
 * Hero art: the interviewer as a glass orb on a glass stage, with three glass cards floating
 * over it (the live question, the round, the signals). Static markup; the float is a CSS
 * animation that stops under reduced motion. Decorative: the copy beside it says the same.
 */
export function HeroScene() {
  return (
    <div aria-hidden className="relative mx-auto aspect-[1/1.02] w-full max-w-[560px] select-none">
      <div className="iq-stage absolute inset-0 !rounded-[44px]" />

      {/* The interviewer: orb with a wide halo. */}
      <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2">
        <span
          className="absolute -inset-24 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle,hsl(var(--brand) / 0.5),hsl(var(--brand-2) / 0.25) 45%,transparent 68%)" }}
        />
        <Orb variant={1} size={176} state="breathing" className="relative" />
      </div>

      {/* Live chip */}
      <div className="iq-glass iq-float-a absolute right-[7%] top-[7%] flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium">
        <span className="h-2 w-2 rounded-full bg-[#34d399] shadow-[0_0_0_3px_rgb(52_211_153/.25)]" />
        Live · 14:12
      </div>

      {/* The question */}
      <div className="iq-glass-card iq-float-b absolute left-[5%] top-[57%] w-[64%] p-4 shadow-float !rounded-[22px]">
        <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
          <span className="font-medium">Interviewer · speaking</span>
          <Waveform bars={14} height={14} className="text-brand" />
        </div>
        <p className="m-0 mt-2 text-[14.5px] leading-[1.45] text-foreground">
          &ldquo;Three pods, 50k requests a second. Where does the rate-limit state live?&rdquo;
        </p>
      </div>

      {/* The round + signals */}
      <div className="iq-glass-card iq-float-a absolute bottom-[5%] right-[5%] w-[52%] p-4 shadow-float !rounded-[22px]">
        <p className="m-0 text-xs font-medium text-ink-3">Round 2 · Problem Solving</p>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          {[
            ["Clarity", "8.2"],
            ["Depth", "7.4"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="m-0 text-xs text-ink-3">{label}</p>
              <p className="m-0 mt-0.5 text-[22px] font-semibold leading-none tracking-[-0.03em]">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
