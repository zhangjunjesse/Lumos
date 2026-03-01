import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 pt-4 pb-4">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="mt-1 h-4 w-48" />
      </div>
      <div className="flex flex-1">
        <div className="w-52 border-r p-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
