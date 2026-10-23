import { MarketingFooter } from "./_components/MarketingFooter";
import { MarketingHeader } from "./_components/MarketingHeader";

/**
 * Marketing shell: a sticky glass header over full-bleed content, and a quiet grey footer. The
 * hero's aurora runs up behind the header so the glass has colour to blur.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="iq-landing flex min-h-screen flex-1 flex-col overflow-x-clip leading-[normal]">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
