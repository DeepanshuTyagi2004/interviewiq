import { cn } from "@/lib/utils/cn";
import { LAYERS } from "./content";
import { LAYER_ART } from "./LayerArt";
import { CONTAINER, Eyebrow } from "./primitives";

/** "One process. Three steps." — three illustrated cards inside a dashed frame. */
export function HowItWorks() {
  return (
    <section id="how" className={cn(CONTAINER, "mt-24 scroll-mt-16 sm:mt-[120px]")}>
      <div className="flex flex-col items-center bg-panel px-4 pb-12 pt-14 sm:px-8 sm:pb-[72px] sm:pt-20">
        <Eyebrow>HOW IT WORKS</Eyebrow>
        <h2
          data-reveal
          className="m-0 mt-3.5 text-center text-[clamp(32px,3.8vw,52px)] font-normal leading-[1.06] tracking-[-0.045em]"
        >
          One process. Three steps.
        </h2>
        <p className="m-0 mt-3.5 max-w-[460px] text-center text-[15px] leading-[1.55] text-muted-foreground">
          Research shapes the interview. The interview drives the debrief. Every debrief makes the next attempt
          sharper.
        </p>
        <div className="mt-12 w-full max-w-[1000px] rounded-[22px] border border-dashed border-line-4 p-3 sm:p-6">
          <ol className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2 lg:grid-cols-3">
            {LAYERS.map((layer) => {
              const Art = LAYER_ART[layer.key];
              return (
                <li
                  key={layer.key}
                  data-reveal
                  className="flex flex-col items-center gap-2.5 rounded-[14px] bg-card md:last:col-span-2 lg:last:col-span-1 px-[22px] pb-[22px] pt-[26px] text-center shadow-hairline transition-shadow duration-300 hover:shadow-lift"
                >
                  <h3 className="m-0 text-[26px] font-normal tracking-[-0.035em]">{layer.title}</h3>
                  <p className="m-0 max-w-[240px] text-[13.5px] leading-[1.5] text-muted-foreground">{layer.body}</p>
                  <div className="flex h-[170px] items-center justify-center">
                    <Art />
                  </div>
                  <ul className="m-0 flex list-none flex-wrap justify-center gap-1.5 p-0">
                    {layer.tags.map((tag) => (
                      <li key={tag} className="rounded-full border border-line-2 px-2.5 py-[5px] text-xs text-muted-foreground">
                        {tag}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
