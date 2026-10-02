import { StubScreen } from "@/components/layout/StubScreen";

export default async function AdminDriveDetailPage({
  params,
}: {
  params: Promise<{ driveId: string }>;
}) {
  const { driveId } = await params;
  // TODO: drive detail
  return (
    <main className="flex-1">
      <StubScreen title={`Drive ${driveId}`} />
    </main>
  );
}
