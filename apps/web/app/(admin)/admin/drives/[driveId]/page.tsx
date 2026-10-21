import { ComingSoon } from "@/components/ds/ComingSoon";

export default async function AdminDriveDetailPage({
  params,
}: {
  params: Promise<{ driveId: string }>;
}) {
  const { driveId } = await params;
  // TODO: drive detail
  return (
    <main className="flex-1">
      <ComingSoon title={`Drive ${driveId}`} />
    </main>
  );
}
