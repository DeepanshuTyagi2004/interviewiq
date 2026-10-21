import Link from "next/link";
import type { SourceKind } from "@/features/profile";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { ConnectionsGrid } from "./_components/ConnectionsGrid";
import { ConnectionsAside } from "./_components/ConnectionsAside";
import { PageHeader } from "@/components/ds";

/** Map the backend's ?error= value to a source so its row shows the error. */
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
    <div>
      <PageHeader
        eyebrow="Connections"
        title="Connect your work"
        description="Optional — but the more we see, the more personal your questions get. We only read public data."
        actions={
          <Button asChild variant="outline">
            <Link href={ROUTES.profile}>View profile</Link>
          </Button>
        }
      />

      <div className="mt-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="sources-heading" className="min-w-0">
          <h2 id="sources-heading" className="sr-only">
            Sources
          </h2>
          <ConnectionsGrid errorSource={errorSource} />
        </section>
        <ConnectionsAside />
      </div>
    </div>
  );
}
