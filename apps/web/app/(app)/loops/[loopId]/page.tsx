import { LoopDetail } from "../_components/LoopDetail";

export default async function LoopDetailPage({ params }: { params: Promise<{ loopId: string }> }) {
  const { loopId } = await params;
  return <LoopDetail loopId={loopId} />;
}
