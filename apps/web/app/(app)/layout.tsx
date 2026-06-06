import { RequireAuth } from "@/components/auth/RequireAuth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // TODO: app shell (sidebar, topbar). Auth gating is client-side via RequireAuth.
  return (
    <RequireAuth>
      <div className="flex-1 flex">{children}</div>
    </RequireAuth>
  );
}
