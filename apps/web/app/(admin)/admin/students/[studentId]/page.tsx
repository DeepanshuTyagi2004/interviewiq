import { ComingSoon } from "@/components/ds/ComingSoon";

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  // TODO: student detail
  return (
    <main className="flex-1">
      <ComingSoon title={`Student ${studentId}`} />
    </main>
  );
}
