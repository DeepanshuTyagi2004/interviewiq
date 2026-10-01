/**
 * The three animated line illustrations on the "How it works" cards. Deterministic geometry,
 * token colours, decorative only. Each animated node carries `data-motion` so reduced-motion
 * users get a still frame.
 */
const INK = "hsl(var(--foreground))";
const ON_INK = "hsl(var(--primary-foreground))";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden className="relative h-[160px] w-[200px]">
      {children}
    </div>
  );
}

/** Research — a stack of isometric sheets gently bobbing. */
function StackArt() {
  return (
    <Frame>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          data-motion
          className="absolute left-1/2 top-1/2"
          style={{ animation: `iq-bob 4s ease-in-out ${i * 0.25}s infinite` }}
        >
          <div
            className="absolute h-24 w-24 rounded-md border"
            style={{
              left: -48,
              top: -48 + 28 - i * 20,
              transform: "rotateX(60deg) rotateZ(45deg)",
              borderColor: INK,
              background: i === 3 ? INK : ON_INK,
            }}
          />
        </div>
      ))}
    </Frame>
  );
}

/** Interview — concentric orbits around "YOU". */
function OrbitArt() {
  return (
    <Frame>
      {[50, 94, 140].map((d, i) => (
        <div
          key={d}
          data-motion
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: d,
            height: d,
            marginLeft: -d / 2,
            marginTop: -d / 2,
            border: `1px ${i === 0 ? "solid" : "dashed"} ${INK}`,
            opacity: 1 - i * 0.25,
            animation: `iq-spin ${14 + i * 8}s linear infinite${i === 1 ? " reverse" : ""}`,
          }}
        >
          {i > 0 ? (
            <span
              className="absolute left-1/2 -top-1 -ml-[3.5px] h-[7px] w-[7px] rounded-full"
              style={{ background: INK }}
            />
          ) : null}
        </div>
      ))}
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px]">YOU</span>
    </Frame>
  );
}

/** Debrief — a radial equaliser of 48 spokes. */
function RadialArt() {
  return (
    <Frame>
      {Array.from({ length: 48 }, (_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 h-0 w-[2px]"
          style={{ transform: `rotate(${i * 7.5}deg)` }}
        >
          <span
            data-motion
            className="absolute bottom-[38px] left-0 w-[2px] origin-bottom rounded-[1px]"
            style={{
              height: Math.round((8 + 24 * Math.abs(Math.sin(i * 0.9))) * 100) / 100,
              background: INK,
              opacity: Math.round((0.3 + 0.7 * Math.abs(Math.cos(i * 0.4))) * 100) / 100,
              animation: `iq-wave ${(0.9 + (i % 6) * 0.15).toFixed(2)}s ease-in-out ${(i * 0.03).toFixed(2)}s infinite`,
            }}
          />
        </span>
      ))}
    </Frame>
  );
}

export const LAYER_ART = {
  research: StackArt,
  interview: OrbitArt,
  debrief: RadialArt,
} as const;
