import { Roadmap } from "./_components/Roadmap";

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <Roadmap jdId={jobId} />;
}
