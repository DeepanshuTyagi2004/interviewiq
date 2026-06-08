"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  Link2,
  LifeBuoy,
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
import { ROUTES } from "@/lib/constants/routes";

const navMain: NavItem[] = [
  { title: "Dashboard", url: ROUTES.dashboard, icon: LayoutDashboard },
  { title: "Profile", url: ROUTES.profile, icon: UserCircle },
  { title: "Connections", url: ROUTES.connections, icon: Link2 },
];

const navSecondary: NavSecondaryItem[] = [
  { title: "Help", url: ROUTES.help, icon: LifeBuoy },
];

export function AppSidebar(
  props: React.ComponentPropsWithoutRef<typeof Sidebar>,
) {
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
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
