import { SessionDetail } from "./_components/SessionDetail";

/** One session: where it stands, when it is, and the one thing to do next (join, retry, debrief). */
export default async function InterviewSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionDetail sessionId={sessionId} />;
}
