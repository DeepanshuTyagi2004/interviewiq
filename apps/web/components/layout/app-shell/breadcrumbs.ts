import { ROUTES } from "@/lib/constants/shared";
import { titleForPath } from "./nav";

export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbNames {
  company?: string;
  /** Lets the company crumb link to the company page on a role screen. */
  companySlug?: string;
  role?: string;
  track?: string;
  process?: string;
}

const SETTINGS_TABS: Record<string, string> = {
  account: "Account",
  notifications: "Notifications",
  privacy: "Privacy & data",
  billing: "Billing & plan",
};

/** The trail shown in the top bar. The last crumb never has an href. */
export function breadcrumbsForPath(pathname: string, names: BreadcrumbNames = {}): Crumb[] {
  const path = pathname.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);

  if (seg[0] === "jobs" && seg[1] === "c" && seg[2]) {
    return [{ label: "Companies", href: ROUTES.jobs }, { label: names.company ?? "Company" }];
  }
  if (seg[0] === "jobs" && seg[1] && seg[1] !== "c" && seg.length === 2) {
    return [
      { label: "Companies", href: ROUTES.jobs },
      names.company && names.companySlug
        ? { label: names.company, href: `${ROUTES.jobs}/c/${names.companySlug}` }
        : { label: names.company ?? "Company" },
      { label: names.role ?? "Role" },
    ];
  }
  if (seg[0] === "loops" && seg[1] && seg.length === 2) {
    return [{ label: "My tracks", href: ROUTES.loops }, { label: names.track ?? "Track" }];
  }
  if (seg[0] === "processes" && seg[1] && seg.length === 2) {
    return [{ label: "Custom processes", href: `${ROUTES.loops}?tab=processes` }, { label: names.process ?? "Process" }];
  }
  if (seg[0] === "interviews" && seg[1] && seg.length === 2) {
    return [{ label: "Interviews", href: ROUTES.interviews }, { label: "Interview" }];
  }
  if (seg[0] === "interviews" && seg[1] && seg[2] === "report" && seg.length === 3) {
    return [
      { label: "Interviews", href: ROUTES.interviews },
      { label: "Interview", href: `${ROUTES.interviews}/${seg[1]}` },
      { label: "Report" },
    ];
  }
  if (seg[0] === "settings") {
    const tab = seg[1] ? SETTINGS_TABS[seg[1]] : undefined;
    return tab ? [{ label: "Settings", href: ROUTES.settings.account }, { label: tab }] : [{ label: "Settings" }];
  }
  return [{ label: titleForPath(path) }];
}
