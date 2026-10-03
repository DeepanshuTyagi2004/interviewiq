import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";

/** The editor moved to /processes/[id]. */
export default async function OldProcessEditorPage({ params }: { params: Promise<{ processId: string }> }) {
  const { processId } = await params;
  redirect(`${ROUTES.processes}/${encodeURIComponent(processId)}`);
}
