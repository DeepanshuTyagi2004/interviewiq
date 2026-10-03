import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";

/** Processes moved to their own page. */
export default function OldProcessesPage() {
  redirect(ROUTES.processes);
}
