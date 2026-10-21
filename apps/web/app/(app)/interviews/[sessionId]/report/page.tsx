import { ReportView } from "./_components/ReportView";

export default async function InterviewReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ReportView sessionId={sessionId} />;
}
