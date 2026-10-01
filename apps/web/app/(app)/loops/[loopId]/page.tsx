export default async function LoopDetailPage({
  params,
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  // TODO: loop detail view
  return <section className="flex-1 p-8">Loop {loopId}</section>;
}
