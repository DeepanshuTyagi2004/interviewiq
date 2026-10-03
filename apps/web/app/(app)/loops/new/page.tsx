import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";

/** A loop starts from a role: pick a company, open a role, confirm its process. */
export default function NewLoopPage() {
  redirect(ROUTES.jobs);
}
