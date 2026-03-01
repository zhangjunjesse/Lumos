import { Skeleton } from "@/components/ui/skeleton";

export default function KnowledgeLoading() {
  return (
    <div className="flex h-full flex-col p-6 gap-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="flex flex-1 gap-6 mt-2">
        <div className="w-64 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
