import { cn } from "@/lib/utils/cn";
import { LAYERS } from "./content";
import { LAYER_ART } from "./LayerArt";
import { CONTAINER } from "./primitives";

/** "One process. Three steps." — three illustrated cards inside a dashed frame. */
export function HowItWorks() {
  return (
    <section id="how" className={cn(CONTAINER, "mt-24 scroll-mt-16 sm:mt-[120px]")}>
      <div className="iq-stage flex flex-col items-center px-4 pb-12 pt-14 sm:px-8 sm:pb-[72px] sm:pt-20">
        <h2
          data-reveal
          className="iq-h2 text-center text-[clamp(32px,4vw,56px)]"
        >
          How it works
        </h2>
        <p className="m-0 mt-3.5 max-w-[460px] text-center text-[17px] leading-[1.5] text-muted-foreground">
          Learn the company&apos;s process. Practise it out loud. Get feedback, then go again.
        </p>
        <div className="mt-12 w-full max-w-[1040px]">
          <ol className="m-0 grid list-none grid-cols-1 gap-y-12 p-0 md:grid-cols-2 lg:grid-cols-3 lg:gap-x-0">
            {LAYERS.map((layer) => {
              const Art = LAYER_ART[layer.key];
              return (
                <li
                  key={layer.key}
                  data-reveal
                  className="flex flex-col items-center gap-2.5 px-6 text-center md:last:col-span-2 lg:border-l lg:border-line-2 lg:first:border-l-0 lg:last:col-span-1"
                >
                  <h3 className="m-0 text-[24px] font-semibold tracking-[-0.03em]">{layer.title}</h3>
                  <p className="m-0 max-w-[240px] text-sm leading-[1.5] text-muted-foreground">{layer.body}</p>
                  <div className="flex h-[170px] items-center justify-center">
                    <Art />
                  </div>
                  <ul className="m-0 flex list-none flex-wrap justify-center gap-1.5 p-0">
                    {layer.tags.map((tag) => (
                      <li key={tag} className="rounded-full bg-surface px-3 py-[5px] text-xs font-medium text-muted-foreground">
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
