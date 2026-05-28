export default async function InterviewReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  // TODO: post-interview report
  return <main className="flex-1 p-8">Report · {sessionId}</main>;
}
