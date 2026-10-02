import { StubScreen } from "@/components/layout/StubScreen";

export default async function LoopDetailPage({
  params,
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  // TODO: loop detail view
  return <StubScreen title={`Loop ${loopId}`} />;
}
