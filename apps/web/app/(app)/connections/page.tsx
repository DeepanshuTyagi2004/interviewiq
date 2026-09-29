import type { SourceKind } from "@/features/profile";
import { PageHeader } from "@/components/patterns";
import { ConnectionsGrid } from "./_components/ConnectionsGrid";

/** Map the backend's ?error= value to a source so its card shows the error. */
function errorToSource(error?: string): SourceKind | undefined {
  if (!error) return undefined;
  if (error.toLowerCase().includes("github")) return "GITHUB";
  return undefined;
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorSource = errorToSource(error);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        title="Connections"
        description="Connect your accounts to build your profile. We only read public data."
      />
      <ConnectionsGrid errorSource={errorSource} />
    </div>
  );
}
