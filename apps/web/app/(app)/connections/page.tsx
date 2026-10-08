import Link from "next/link";
import type { SourceKind } from "@/features/profile";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { ConnectionsGrid } from "./_components/ConnectionsGrid";
import { ConnectionsAside } from "./_components/ConnectionsAside";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

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
    <div className={PAGE_SCAFFOLD}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">Connections</p>
          <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
            Connect your work
          </h1>
          <p className="m-0 mt-1.5 max-w-2xl text-[14px] leading-[1.5] text-muted-foreground">
            Optional — but the more we see, the more personal your questions get. We only read public data.
          </p>
        </div>
        <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
          <Link href={ROUTES.profile}>View profile</Link>
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
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
