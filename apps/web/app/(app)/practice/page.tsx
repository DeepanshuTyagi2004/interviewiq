import { ComingSoon } from "@/components/ds";
import { ROUTES } from "@/lib/constants/shared";

export default function PracticePage() {
  return (
    <ComingSoon
      title="Practice is coming soon"
      hint="Targeted practice from your interview gaps."
      href={ROUTES.jobs}
      cta="Go to Companies"
    />
  );
}
