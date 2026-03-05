"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface Binding {
  id: string;
  chatId: string;
  status: string;
  createdAt: string;
}

interface BindingListProps {
  sessionId: string;
  onUnbind?: () => void;
}

export function BindingList({ sessionId, onUnbind }: BindingListProps) {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBindings = async () => {
    try {
      const res = await fetch(`/api/bridge/bindings?sessionId=${sessionId}`);
      const data = await res.json();
      setBindings(data.bindings?.filter((b: Binding) => b.status === "active") || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBindings();
  }, [sessionId]);

  const handleUnbind = async (id: string) => {
    try {
      await fetch(`/api/bridge/bindings/${id}`, { method: "DELETE" });
      await fetchBindings();
      onUnbind?.();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground">加载中...</div>;
  if (bindings.length === 0) {
    return <div className="text-sm text-muted-foreground">暂无绑定</div>;
  }

  return (
    <div className="space-y-2">
      {bindings.map((b) => (
        <div key={b.id} className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">飞书群组</p>
            <p className="text-xs text-muted-foreground">{b.chatId}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => handleUnbind(b.id)}>
            解绑
          </Button>
        </div>
      ))}
    </div>
  );
}
