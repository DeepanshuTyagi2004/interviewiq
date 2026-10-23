"use client";

import Link from "next/link";
import { CalendarPlus, Code, Link2, MessageSquare, Route, Search, type LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useJds, type JdSummary } from "@/features/jobs";
import { GlyphTile } from "@/components/ds";
import { ROUTES } from "@/lib/constants/shared";

const FIND_STATIC = "Browse every role";

/** "42 open roles" once the list has loaded; static copy while loading, on error or with nothing to count. */
export function rolesSubtitle(jds: JdSummary[] | undefined, isError: boolean): string {
  if (isError || !jds) return FIND_STATIC;
  const n = jds.filter((j) => !j.practiceTemplate).length;
  if (n === 0) return FIND_STATIC;
  return `${n.toLocaleString("en-US")} open ${n === 1 ? "role" : "roles"}`;
}

interface Tile {
  key: string;
  href: string;
  title: string;
  hint: string;
  Icon: LucideIcon;
  /** Which of the eight art hues the glyph tile uses. */
  tone: number;
}

const TILES: Tile[] = [
  { key: "schedule", href: ROUTES.interviews, title: "Schedule round", hint: "Book your next mock", Icon: CalendarPlus, tone: 0 },
  { key: "find", href: ROUTES.jobs, title: "Find a role", hint: FIND_STATIC, Icon: Search, tone: 5 },
  { key: "track", href: ROUTES.loops, title: "Start a track", hint: "A company's full loop", Icon: Route, tone: 1 },
  { key: "sources", href: ROUTES.connections, title: "Connect sources", hint: "GitHub, LeetCode…", Icon: Link2, tone: 4 },
  { key: "practice", href: ROUTES.practice, title: "Practice", hint: "From your gaps", Icon: Code, tone: 3 },
  { key: "share", href: ROUTES.shareExperience, title: "Share experience", hint: "Help others prep", Icon: MessageSquare, tone: 2 },
];

/** Six quick-start tiles. Only "Find a role" carries a live number, from the roles list. */
export function QuickTiles() {
  const jds = useJds();
  const { interviewBlocked } = useCurrentUser();
  // "Schedule round" is hidden for accounts without interview access.
  const tiles = interviewBlocked ? TILES.filter((t) => t.key !== "schedule") : TILES;
  return (
    <ul
      aria-label="Quick start"
      className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-6"
    >
      {tiles.map(({ key, href, title, hint, Icon, tone }, i) => (
        <li key={key} className="iq-fade-up min-w-0" style={{ "--i": i } as React.CSSProperties}>
          <Link
            href={href}
            className="group block h-full rounded-card bg-card p-3.5 shadow-ring outline-none transition-[transform,box-shadow] duration-300 ease-iq hover:-translate-y-0.5 hover:shadow-float focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <GlyphTile tone={tone} size={52} className="mb-3 transition-transform duration-300 ease-iq group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <Icon aria-hidden className="h-6 w-6" strokeWidth={1.7} />
            </GlyphTile>
            <span className="block truncate text-[13.5px] font-medium" title={title}>
              {title}
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
              {key === "find" ? rolesSubtitle(jds.data, jds.isError) : hint}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
