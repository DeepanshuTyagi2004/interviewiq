import { MarketingFooter } from "./_components/MarketingFooter";
import { MarketingHeader } from "./_components/MarketingHeader";

/**
 * Marketing shell from the design: a sticky header on the grey frame, page content in a rounded
 * white card inset from the edges, and a frame-coloured footer.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="iq-landing flex min-h-screen flex-1 flex-col overflow-x-clip bg-frame leading-[normal]">
      <MarketingHeader />
      <main className="mx-2 flex-1 overflow-hidden rounded-[14px] border border-line-3 bg-card sm:mx-3">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
