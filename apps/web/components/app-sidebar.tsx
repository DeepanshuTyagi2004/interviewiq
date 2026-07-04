"use client";

import Link from "next/link";
import {
  Activity,
  Briefcase,
  CalendarClock,
  LayoutDashboard,
  Link2,
  LifeBuoy,
  Send,
  Sparkles,
  UserCircle,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavMain, type NavItem } from "@/components/nav-main";
import { NavSecondary, type NavSecondaryItem } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";

const navMain: NavItem[] = [
  { title: "Dashboard", url: ROUTES.dashboard, icon: LayoutDashboard },
  { title: "Profile", url: ROUTES.profile, icon: UserCircle },
  { title: "Connections", url: ROUTES.connections, icon: Link2 },
  { title: "Jobs", url: ROUTES.jobs, icon: Briefcase },
  { title: "Interviews", url: ROUTES.interviews, icon: CalendarClock },
  { title: "Share experience", url: ROUTES.shareExperience, icon: Send },
];

/** Admin-only nav entries, appended when the current user is an admin. */
const adminNav: NavItem[] = [
  { title: "Intelligence", url: ROUTES.intelligence, icon: Activity },
];

const navSecondary: NavSecondaryItem[] = [
  { title: "Help", url: ROUTES.help, icon: LifeBuoy },
];

export function AppSidebar(
  props: React.ComponentPropsWithoutRef<typeof Sidebar>,
) {
  const { isAdmin } = useCurrentUser();
  const items = isAdmin ? [...navMain, ...adminNav] : navMain;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-[--header-height] justify-center border-b border-sidebar-border group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href={ROUTES.dashboard}>
                <Sparkles className="!size-5" />
                <span className="text-base font-semibold tracking-tight">
                  InterviewIQ
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
