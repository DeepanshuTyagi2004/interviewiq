import { LiveRoom } from "./_components/LiveRoom";

export default async function LiveInterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <LiveRoom sessionId={sessionId} />;
}
