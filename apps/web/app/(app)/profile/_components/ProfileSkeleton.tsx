import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

/** Loading state that mirrors the profile's header and facts-left / story-right layout. */
export function ProfileSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading your profile"
      className={PAGE_SCAFFOLD}
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[200px] w-full rounded-[10px]" />
          <Skeleton className="h-[82px] w-full rounded-[10px]" />
          <Skeleton className="h-40 w-full rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-36 w-full rounded-[10px]" />
          <Skeleton className="h-[320px] w-full rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}
