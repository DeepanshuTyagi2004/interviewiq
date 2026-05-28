export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  // TODO: job detail view
  return <main className="flex-1 p-8">Job {jobId}</main>;
}
