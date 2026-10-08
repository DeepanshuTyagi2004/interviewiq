import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { HudScope } from "@/components/hud/scope";

/**
 * The TPO admin panel shell (not built yet). Gated on the admin role so its placeholder screens are
 * never reachable by students; RequireAdmin shows "Admins only" otherwise.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireAdmin>
        <HudScope />
        <div className="flex-1 flex">{children}</div>
      </RequireAdmin>
    </RequireAuth>
  );
}
