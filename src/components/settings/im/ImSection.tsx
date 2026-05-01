"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading } from "@hugeicons/core-free-icons";
import { ImProviderCard } from "./ImProviderCard";
import { ImDefaultPicker } from "./ImDefaultPicker";
import type { IMProviderManifest } from "@/lib/im";

interface ProviderRow {
  manifest: IMProviderManifest;
  configured: boolean;
  enabled: boolean;
  isDefault: boolean;
}

export function ImSection() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/im/providers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "load failed");
      setProviders(data.providers ?? []);
      setDefaultProviderId(data.defaultProviderId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin" />
        加载 IM 列表中…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        当前没有注册的 IM provider。代码层在 <code>src/lib/im/index.ts</code> 注册。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">IM 通讯</h2>
        <p className="text-sm text-muted-foreground">
          选择并配置即时通讯渠道。已启用的 IM 可被工作流、Agent 主动外发使用。
        </p>
      </div>

      <ImDefaultPicker
        providers={providers}
        defaultProviderId={defaultProviderId}
        onChanged={refresh}
      />

      <div className="flex flex-col gap-4">
        {providers.map((row) => (
          <ImProviderCard key={row.manifest.id} state={row} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}
