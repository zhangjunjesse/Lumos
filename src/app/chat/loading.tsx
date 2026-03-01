import { Skeleton } from "@/components/ui/skeleton";

export default function ChatLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
