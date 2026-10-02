import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { cn } from "@/lib/utils/cn";

/** Loading state that mirrors the profile's header and facts-left / story-right layout. */
export function ProfileSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading your profile"
      className={cn(PAGE_SCAFFOLD, "lg:min-h-0 lg:flex-1 lg:pb-0")}
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-5 grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex flex-col gap-3 lg:overflow-hidden">
          {/* Identity card: avatar row + the interview score Readout tile. */}
          <Skeleton className="h-[240px] w-full rounded-[14px]" />
          <Skeleton className="h-[82px] w-full rounded-[14px]" />
          <Skeleton className="h-40 w-full rounded-[14px]" />
        </div>
        <div className="flex flex-col gap-3 lg:overflow-hidden">
          <Skeleton className="h-36 w-full rounded-[14px]" />
          <Skeleton className="h-[320px] w-full rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}
