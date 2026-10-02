import {
  Activity,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  Mic,
  Send,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ROUTES } from "@/lib/constants/shared";

export interface AppNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Only shown to admins. */
  adminOnly?: boolean;
  /** Extra words the command menu matches on. */
  keywords?: string[];
}

/** Every destination in the signed-in app, in menu order. */
export const APP_NAV: AppNavItem[] = [
  { label: "Dashboard", href: ROUTES.dashboard, icon: LayoutDashboard, keywords: ["home"] },
  { label: "Companies", href: ROUTES.jobs, icon: Building2, keywords: ["jobs", "roles", "roadmap"] },
  { label: "Interviews", href: ROUTES.interviews, icon: Mic, keywords: ["room", "schedule", "book", "debrief"] },
  { label: "Profile", href: ROUTES.profile, icon: UserRound, keywords: ["resume", "skills"] },
  { label: "Connections", href: ROUTES.connections, icon: Link2, keywords: ["github", "leetcode", "sources"] },
  { label: "Share experience", href: ROUTES.shareExperience, icon: Send, keywords: ["experience", "contribute"] },
  { label: "Help", href: ROUTES.help, icon: LifeBuoy, keywords: ["support", "faq"] },
  { label: "Intelligence", href: ROUTES.intelligence, icon: Activity, adminOnly: true, keywords: ["admin"] },
];

export function navFor(isAdmin: boolean): AppNavItem[] {
  return APP_NAV.filter((item) => isAdmin || !item.adminOnly);
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Title shown in the card header, including the design's names for nested screens. */
export function titleForPath(pathname: string): string {
  if (/^\/interviews\/[^/]+\/live/.test(pathname)) return "Interview room";
  if (/^\/interviews\/[^/]+\/report/.test(pathname)) return "Debrief";
  if (/^\/jobs\/[^/]+/.test(pathname)) return "Roadmap";
  if (pathname.startsWith("/settings")) return "Settings";
  if (isActivePath(pathname, ROUTES.leaderboard)) return "Leaderboard";
  const match = APP_NAV.find((item) => isActivePath(pathname, item.href));
  return match?.label ?? "InterviewIQ";
}
