import { HudCard, HudEmpty } from "@/components/hud";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

/**
 * Placeholder for a screen that isn't built yet: one HUD card on the dot grid, with the page's
 * title and a short hint. Shared by the app and admin stub routes.
 */
export function StubScreen({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={PAGE_SCAFFOLD}>
      <HudCard title={title} titleAs="h1" className="hud-grid">
        <HudEmpty tag="Not built yet" title={title} hint={hint ?? "This screen is on the way."} />
      </HudCard>
    </div>
  );
}
