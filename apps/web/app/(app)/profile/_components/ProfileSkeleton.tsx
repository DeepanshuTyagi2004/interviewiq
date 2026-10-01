import { Skeleton } from "@/components/ui/skeleton";

/** Loading state that mirrors the profile's header and two-column layout. */
export function ProfileSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading your profile"
      className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10"
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-7 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[270px] w-full rounded-[10px]" />
          <Skeleton className="h-[82px] w-full rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[270px] w-full rounded-[10px]" />
          <Skeleton className="h-48 w-full rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}
