import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { EnrichmentEditor } from "../../../_components/enrichment/EnrichmentEditor";

export default async function EnrichmentPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <RequireAdmin><EnrichmentEditor key={companyId} companyId={companyId} /></RequireAdmin>;
}
