import { cn } from "@/lib/utils/cn";
import { Accordion } from "./Accordion";
import { FAQS } from "./content";
import { CONTAINER } from "./primitives";

const ITEMS = FAQS.map(([title, body]) => ({ title, body }));

export function Faq() {
  return (
    <section
      id="faq"
      className={cn(CONTAINER, "flex scroll-mt-16 flex-col gap-8 py-24 sm:py-[140px] lg:flex-row lg:gap-14")}
    >
      <h2 data-reveal className="iq-h2 lg:flex-[1_1_320px]">
        Frequently asked questions
      </h2>
      <div className="min-w-0 lg:flex-[1.4_1_480px]">
        <Accordion items={ITEMS} variant="plus" />
      </div>
    </section>
  );
}
