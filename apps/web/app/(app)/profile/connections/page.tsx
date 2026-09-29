import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";

/** The connections hub now lives at the top level. */
export default function ProfileConnectionsRedirect() {
  redirect(ROUTES.connections);
}
