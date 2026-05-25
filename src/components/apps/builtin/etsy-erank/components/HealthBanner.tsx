'use client';

import * as React from 'react';

export interface HealthStatus {
  adspower: {
    available: boolean;
    profileId: string;
    apiBase: string;
    debugPort?: string;
    error?: string;
  };
  llm: {
    available: boolean;
    providerName?: string;
    baseUrl?: string;
    model?: string;
    error?: string;
  };
}

// 模块级缓存 + 订阅,避免多个组件各 fetch 一次
let cached: HealthStatus | null = null;
let inflight: Promise<HealthStatus | null> | null = null;
const subscribers = new Set<(h: HealthStatus | null) => void>();

async function fetchHealth(): Promise<HealthStatus | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/apps/builtin/etsy-erank/health');
      if (!res.ok) return null;
      const json = await res.json() as HealthStatus;
      cached = json;
      subscribers.forEach((cb) => cb(json));
      return json;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useEtsyErankHealth() {
  const [health, setHealth] = React.useState<HealthStatus | null>(cached);
  const [loading, setLoading] = React.useState(!cached);

  const probe = React.useCallback(async () => {
    setLoading(true);
    const h = await fetchHealth();
    setHealth(h);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (!cached) probe();
    const cb = (h: HealthStatus | null) => setHealth(h);
    subscribers.add(cb);
    // 后台 30s 自动重测,AdsPower 重启 / LLM provider 变更后能尽快反映
    const t = setInterval(() => fetchHealth(), 30_000);
    return () => {
      subscribers.delete(cb);
      clearInterval(t);
    };
  }, [probe]);

  return { health, loading, probe };
}

export function HealthBanner(): React.ReactElement | null {
  const { health, loading, probe } = useEtsyErankHealth();

  if (loading && !health) return null;
  if (!health) return null;
  const adsOk = health.adspower.available;
  const llmOk = health.llm.available;
  if (adsOk && llmOk) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/40 px-3 py-2 text-[11px] text-emerald-800 dark:bg-emerald-950/20">
        ✓ AdsPower 已连(profile {health.adspower.profileId} · port {health.adspower.debugPort}) · LLM 已连({health.llm.providerName} · {health.llm.model})
        <button type="button" onClick={probe} className="ml-2 underline opacity-70">重测</button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-50/40 p-3 text-[11px] text-amber-800 dark:bg-amber-950/20">
      <div className="font-semibold">环境检查:有依赖未就绪</div>
      {!adsOk && (
        <div>
          ✗ <span className="font-medium">AdsPower 不可用</span>(profile {health.adspower.profileId} @ {health.adspower.apiBase}):{health.adspower.error}
          <div className="mt-0.5 opacity-80">解决:启动 AdsPower 桌面端 + 在 .env 配 ADSPOWER_PROFILE_ID(当前 {health.adspower.profileId})</div>
        </div>
      )}
      {!llmOk && (
        <div>
          ✗ <span className="font-medium">LLM Provider 不可用</span>
          {health.llm.providerName && `(当前选的:${health.llm.providerName} · ${health.llm.baseUrl})`}:{health.llm.error}
          <div className="mt-0.5 opacity-80">解决:在 Lumos 设置 → 服务商 切换到一个支持 text-gen 的 anthropic-compatible provider(例如 ClaudeUltra / Claude / 小米)</div>
        </div>
      )}
      <button type="button" onClick={probe} className="underline">重测</button>
    </div>
  );
}
