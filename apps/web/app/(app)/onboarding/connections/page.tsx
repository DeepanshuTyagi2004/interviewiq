import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";

/** Onboarding shares the single connections hub. */
export default function OnboardingConnectionsRedirect() {
  redirect(ROUTES.connections);
}
