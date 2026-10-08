import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { ValidationControlsPanel } from "./_components/ValidationControlsPanel";

export default function AdminSettingsPage() {
  return (
    <RequireAdmin>
      <ValidationControlsPanel />
    </RequireAdmin>
  );
}
