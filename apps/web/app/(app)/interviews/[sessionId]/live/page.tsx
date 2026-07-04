import LiveInterview from "./_components/LiveInterview";

export default async function LiveInterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <LiveInterview sessionId={sessionId} />;
}
