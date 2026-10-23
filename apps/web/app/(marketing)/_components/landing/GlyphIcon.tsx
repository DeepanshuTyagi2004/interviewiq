import { Code2, Compass, Gauge, Link2, ListChecks, Mic, RefreshCw, Route, Unlock, UserRound, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  compass: Compass,
  route: Route,
  link: Link2,
  mic: Mic,
  code: Code2,
  refresh: RefreshCw,
  list: ListChecks,
  gauge: Gauge,
  unlock: Unlock,
  user: UserRound,
};

/** A drawn line icon (one stroke weight) for a landing-page list item, by name. Decorative. */
export function GlyphIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Compass;
  return <Icon aria-hidden strokeWidth={1.7} className={className ?? "h-3.5 w-3.5"} />;
}
