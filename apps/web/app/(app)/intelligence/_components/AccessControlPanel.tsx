"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoPill } from "@/components/patterns";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { padCount } from "@/components/hud";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { useCurrentUser, type Role } from "@/lib/hooks/useCurrentUser";
import { useUpdateUserRole, useUsers, type AdminUser } from "@/features/intelligence";

export function AccessControlPanel() {
  const { data: users, isLoading, isError } = useUsers();
  const { user: me } = useCurrentUser();
  const updateRole = useUpdateUserRole();

  function changeRole(target: AdminUser, role: Role) {
    updateRole.mutate(
      { id: target.id, role },
      {
        onSuccess: () =>
          toast.success(
            role === "ADMIN"
              ? `${target.name || target.email} is now an admin.`
              : `${target.name || target.email} is now a regular user.`,
          ),
        onError: () => toast.error("Could not update the role."),
      },
    );
  }

  const admins = users?.filter((u) => u.role === "ADMIN").length ?? 0;

  return (
    <ConsoleCard
      title="Users & roles"
      meta={
        users ? (
          <HeaderCount>
            {padCount(users.length)} {users.length === 1 ? "user" : "users"} · {padCount(admins)}{" "}
            {admins === 1 ? "admin" : "admins"}
          </HeaderCount>
        ) : null
      }
    >
      {isLoading ? (
        <div className="space-y-2 p-4 sm:px-5" aria-busy="true" aria-label="Loading users">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError || !users ? (
        <p role="alert" className="m-0 px-4 py-6 text-sm text-destructive sm:px-5">
          Could not load users.
        </p>
      ) : users.length === 0 ? (
        <CardEmpty title="No users yet." />
      ) : (
        <HairlineTable label="Users and roles" className="min-w-[640px]">
          <HairlineHead>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th className="text-right">
              <span className="sr-only">Change role</span>
            </Th>
          </HairlineHead>
          <tbody>
            {users.map((u) => {
              const isSelf = me?.id === u.id;
              const target: Role = u.role === "ADMIN" ? "USER" : "ADMIN";
              const pending = updateRole.isPending && updateRole.variables?.id === u.id;
              return (
                <Tr key={u.id}>
                  <Td className="text-sm">
                    {u.name || <span className="text-faint">—</span>}
                    {isSelf ? <span className="ml-1.5 text-faint">(you)</span> : null}
                  </Td>
                  <Td className="font-mono text-xs text-muted-foreground">{u.email}</Td>
                  <Td>
                    <MonoPill tone={u.role === "ADMIN" ? "ink" : "soft"}>{u.role}</MonoPill>
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant={u.role === "ADMIN" ? "outline" : "strong"}
                      disabled={pending || isSelf}
                      onClick={() => changeRole(u, target)}
                      title={isSelf ? "You can't change your own role" : undefined}
                    >
                      {u.role === "ADMIN" ? "Demote to user" : "Promote to admin"}
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </HairlineTable>
      )}
    </ConsoleCard>
  );
}
