import type { SourceKind } from "@/features/profile";
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
    <main className="flex-1 space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Connections</h2>
        <p className="text-sm text-muted-foreground">
          Connect your accounts to build your profile. We only read public data.
        </p>
      </div>
      <ConnectionsGrid errorSource={errorSource} />
    </main>
  );
}
