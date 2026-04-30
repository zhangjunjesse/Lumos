"use client";

import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { IMProviderManifest } from "@/lib/im";

interface ImDefaultPickerProps {
  providers: Array<{ manifest: IMProviderManifest; enabled: boolean }>;
  defaultProviderId: string | null;
  onChanged: () => void;
}

const NONE_VALUE = "__none__";

export function ImDefaultPicker({ providers, defaultProviderId, onChanged }: ImDefaultPickerProps) {
  const handleChange = useCallback(
    async (value: string) => {
      const provider = value === NONE_VALUE ? null : value;
      try {
        await fetch("/api/im/default", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        onChanged();
      } catch {
        // surface errors via parent's load loop
      }
    },
    [onChanged],
  );

  const enabledProviders = providers.filter((p) => p.enabled);

  return (
    <div className="rounded-lg border border-border/50 p-4">
      <Label className="text-sm font-medium">默认 IM</Label>
      <p className="mb-3 text-xs text-muted-foreground">
        Agent 主动外发、工作流通知、定时任务的消息发送，默认走这个 IM。
      </p>
      <Select
        value={defaultProviderId ?? NONE_VALUE}
        onValueChange={handleChange}
        disabled={enabledProviders.length === 0}
      >
        <SelectTrigger className="max-w-sm">
          <SelectValue placeholder={enabledProviders.length === 0 ? "（先启用一个 IM）" : "选择默认 IM"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>无（不主动发消息）</SelectItem>
          {enabledProviders.map((p) => (
            <SelectItem key={p.manifest.id} value={p.manifest.id}>
              {p.manifest.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
