export default async function InterviewLivePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  // TODO: live interview UI (video/audio, prompts)
  return <main className="flex-1 p-8">Live · {sessionId}</main>;
}
