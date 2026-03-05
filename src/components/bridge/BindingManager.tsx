"use client";

import { Button } from "@/components/ui/button";

interface Binding {
  id: string;
  chatId: string;
  chatName: string;
  createdAt: string;
}

interface BindingManagerProps {
  bindings: Binding[];
  onUnbind?: (id: string) => void;
}

export function BindingManager({ bindings, onUnbind }: BindingManagerProps) {
  if (bindings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        暂无绑定的飞书群组
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {bindings.map((binding) => (
        <div key={binding.id} className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">{binding.chatName}</p>
            <p className="text-xs text-muted-foreground">{binding.chatId}</p>
          </div>
          {onUnbind && (
            <Button size="sm" variant="ghost" onClick={() => onUnbind(binding.id)}>
              解绑
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
