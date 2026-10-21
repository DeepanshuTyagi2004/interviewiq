import {
  Activity,
  Building2,
  CalendarDays,
  Code2,
  Home,
  LifeBuoy,
  Link2,
  MessageSquare,
  ShieldCheck,
  Trophy,
  UserRound,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { ROUTES } from "@/lib/constants/shared";

export type NavGroupId = "main" | "build" | "you" | "admin";

export interface AppNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Only shown to admins. */
  adminOnly?: boolean;
  /** Extra words the command menu matches on. */
  keywords?: string[];
}

/** Every destination in the signed-in app, as the flat list the command menu searches. */
export const APP_NAV: AppNavItem[] = [
  { label: "Home", href: ROUTES.dashboard, icon: Home, group: "main", keywords: ["dashboard"] },
  { label: "Companies", href: ROUTES.jobs, icon: Building2, group: "main", keywords: ["jobs", "roles", "roadmap"] },
  { label: "Tracks", href: ROUTES.loops, icon: Waypoints, group: "main", keywords: ["my tracks", "loops", "subscribed", "schedule", "slots", "targets", "watchlist"] },
  { label: "Interviews", href: ROUTES.interviews, icon: CalendarDays, group: "main", keywords: ["room", "schedule", "book", "debrief"] },
  { label: "Practice", href: ROUTES.practice, icon: Code2, group: "main", keywords: ["problems", "drills", "gaps"] },
  { label: "Processes", href: ROUTES.processes, icon: Workflow, group: "build", keywords: ["interview processes", "process", "custom", "create", "editor", "flow", "rounds"] },
  { label: "Share experience", href: ROUTES.shareExperience, icon: MessageSquare, group: "build", keywords: ["experience", "experiences", "contribute"] },
  { label: "Profile", href: ROUTES.profile, icon: UserRound, group: "you", keywords: ["resume", "skills"] },
  { label: "Connections", href: ROUTES.connections, icon: Link2, group: "you", keywords: ["github", "leetcode", "sources"] },
  { label: "Leaderboard", href: ROUTES.leaderboard, icon: Trophy, group: "you", keywords: ["rank", "ranking"] },
  { label: "Intelligence", href: ROUTES.intelligence, icon: Activity, group: "admin", adminOnly: true, keywords: ["admin"] },
  { label: "Validation controls", href: ROUTES.admin.settings, icon: ShieldCheck, group: "admin", adminOnly: true, keywords: ["admin", "validation", "settings"] },
];

/** Help is the sidebar's bottom link, outside the groups. It stays searchable in the command menu. */
export const HELP_NAV: AppNavItem = {
  label: "Help",
  href: ROUTES.help,
  icon: LifeBuoy,
  group: "main",
  keywords: ["support", "faq"],
};

export function navFor(isAdmin: boolean): AppNavItem[] {
  return [...APP_NAV, HELP_NAV].filter((item) => isAdmin || !item.adminOnly);
}

const GROUP_LABELS: Record<NavGroupId, string | null> = { main: null, build: "Build", you: "You", admin: "Admin" };
const GROUP_ORDER: NavGroupId[] = ["main", "build", "you", "admin"];

/** The sidebar's groups in order; the admin group only for admins. */
export function navGroupsFor(isAdmin: boolean): { id: NavGroupId; label: string | null; items: AppNavItem[] }[] {
  return GROUP_ORDER.filter((id) => id !== "admin" || isAdmin).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    items: APP_NAV.filter((item) => item.group === id && (isAdmin || !item.adminOnly)),
  }));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Screen name shown in the top bar, including the design's names for nested screens. */
export function titleForPath(pathname: string): string {
  if (/^\/interviews\/[^/]+\/live/.test(pathname)) return "Interview room";
  if (/^\/interviews\/[^/]+\/report/.test(pathname)) return "Debrief";
  if (/^\/jobs\/c\//.test(pathname)) return "Companies";
  if (/^\/jobs\/[^/]+/.test(pathname)) return "Roadmap";
  if (/^\/processes\/[^/]+/.test(pathname)) return "Process editor";
  if (/^\/loops\/[^/]+/.test(pathname)) return "Track";
  if (pathname.startsWith("/settings")) return "Settings";
  if (isActivePath(pathname, ROUTES.leaderboard)) return "Leaderboard";
  const match = [...APP_NAV, HELP_NAV].find((item) => isActivePath(pathname, item.href));
  return match?.label ?? "InterviewIQ";
}
