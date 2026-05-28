export default async function InterviewSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  // TODO: session lobby (pre-interview checks, start CTA)
  return <main className="flex-1 p-8">Interview Session {sessionId}</main>;
}
