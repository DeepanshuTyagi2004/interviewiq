import { Skeleton } from "@/components/ui/skeleton";

/** Loading state that mirrors the profile's header and facts-left / story-right layout. */
export function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your profile">
      <div className="flex items-center gap-5">
        <Skeleton className="h-[72px] w-[72px] flex-none rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-9 w-56 max-w-full" />
          <Skeleton className="mt-3 h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-[160px] w-full rounded-card" />
          <Skeleton className="h-[320px] w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-36 w-full rounded-card" />
          <Skeleton className="h-[320px] w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
