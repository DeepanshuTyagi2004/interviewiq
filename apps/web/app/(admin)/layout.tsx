import { RequireAuth } from "@/components/auth/RequireAuth";
import { HudScope } from "@/components/hud/scope";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // TODO: admin shell. Auth gating is client-side via RequireAuth.
  // TODO: enforce admin role once role data is available from the backend.
  return (
    <RequireAuth>
      <HudScope />
      <div className="flex-1 flex">{children}</div>
    </RequireAuth>
  );
}
