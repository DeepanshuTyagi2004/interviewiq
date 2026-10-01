import Link from "next/link";
import type { SourceKind } from "@/features/profile";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { ConnectionsGrid } from "./_components/ConnectionsGrid";
import { ConnectionsAside } from "./_components/ConnectionsAside";

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
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">Connections</p>
          <h1 className="m-0 mt-2.5 text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
            Connect your work
          </h1>
          <p className="m-0 mt-2 max-w-xl text-[15px] leading-[1.5] text-muted-foreground">
            Optional — but the more we see, the more personal your questions get. We only read public data.
          </p>
        </div>
        <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
          <Link href={ROUTES.profile}>View profile</Link>
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
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
