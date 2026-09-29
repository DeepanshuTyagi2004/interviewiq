"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTablePattern, type DataTableColumn } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
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

  if (isLoading) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }
  if (isError || !users) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load users.
      </p>
    );
  }

  const columns: DataTableColumn<AdminUser>[] = [
    { header: "Name", cell: (u) => u.name || "—" },
    { header: "Email", cell: (u) => <span className="font-mono text-xs">{u.email}</span> },
    {
      header: "Role",
      cell: (u) => (
        <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
      ),
    },
    {
      header: "",
      className: "text-right",
      cell: (u) => {
        const isSelf = me?.id === u.id;
        const target: Role = u.role === "ADMIN" ? "USER" : "ADMIN";
        const pending = updateRole.isPending && updateRole.variables?.id === u.id;
        return (
          <Button
            size="sm"
            variant={u.role === "ADMIN" ? "outline" : "default"}
            disabled={pending || isSelf}
            onClick={() => changeRole(u, target)}
            title={isSelf ? "You can't change your own role" : undefined}
          >
            {u.role === "ADMIN" ? "Demote to user" : "Promote to admin"}
          </Button>
        );
      },
    },
  ];

  return (
    <DataTablePattern
      columns={columns}
      rows={users}
      rowKey={(u) => u.id}
      empty="No users yet."
    />
  );
}
