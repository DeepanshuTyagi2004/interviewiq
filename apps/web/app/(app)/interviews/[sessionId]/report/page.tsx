import { ReportPlaceholder } from "./_components/ReportPlaceholder";

export default async function InterviewReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ReportPlaceholder sessionId={sessionId} />;
}
