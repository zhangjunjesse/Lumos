"use client";

import { Card } from "@/components/ui/card";

interface KbStatCardsProps {
  stats: {
    total_documents: number;
    total_chunks: number;
    storage_bytes: number;
  };
}

export function KbStatCards({ stats }: KbStatCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-3 px-5 py-3">
      <StatCard label="Documents" value={String(stats.total_documents)} />
      <StatCard
        label="Storage"
        value={formatBytes(stats.storage_bytes)}
      />
      <StatCard label="Chunks" value={String(stats.total_chunks)} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-3 py-2.5 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
