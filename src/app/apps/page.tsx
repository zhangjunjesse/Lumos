'use client';

import * as React from 'react';

import {
  BuiltinDeepResearchCard,
  BuiltinDouyinCollectorCard,
  BuiltinEcommerceCard,
  BuiltinEtsyErankCard,
  BuiltinEtsyForgeCard,
  BuiltinGoofishCard,
  BuiltinMeshTradingTeamCard,
  BuiltinPinterestRadarCard,
  BuiltinWeChatCard,
  BuiltinXRadarCard,
  type BuiltinXRadarStatus,
} from '@/components/apps/list/BuiltinAppCard';

interface BuiltinWeChatStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  export?: { ready: boolean; phase: string; supported: boolean; keyCount?: number };
  im?: { enabled: boolean; configured: boolean; isDefault: boolean };
}

interface BuiltinGoofishStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  auth?: { ready: boolean; accountCount: number; loggedInCount: number };
  ready?: boolean;
  phase?: string;
}

interface BuiltinEcommerceStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  providers?: { analysis: { ok: boolean }; image: { ok: boolean } };
  inventory?: { runningJobs: number; inputCount: number };
  ready?: boolean;
  phase?: string;
}

interface BuiltinDouyinCollectorStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  auth?: { ready: boolean; cookieValid: boolean; lastCheckedAt: string | null };
  sources?: { creators: number; keywords: number };
  queue?: { runningJobs: number; pendingJobs: number; lastRunFailure: string | null };
  library?: { videos: number; drafts: number; published: number };
  ready?: boolean;
  phase?: string;
}

interface BuiltinDeepResearchStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  tasks?: { total: number; active: number; paused: number; delivered: number; failed: number };
  library?: { evidence: number; reports: number };
  ready?: boolean;
  phase?: string;
}

export default function AppsListPage(): React.ReactElement {
  const [wechatStatus, setWechatStatus] = React.useState<BuiltinWeChatStatus | null>(null);
  const [goofishStatus, setGoofishStatus] = React.useState<BuiltinGoofishStatus | null>(null);
  const [ecommerceStatus, setEcommerceStatus] = React.useState<BuiltinEcommerceStatus | null>(null);
  const [douyinCollectorStatus, setDouyinCollectorStatus] =
    React.useState<BuiltinDouyinCollectorStatus | null>(null);
  const [deepResearchStatus, setDeepResearchStatus] =
    React.useState<BuiltinDeepResearchStatus | null>(null);
  const [xRadarStatus, setXRadarStatus] = React.useState<BuiltinXRadarStatus | null>(null);
  const [visibleBuiltinIds, setVisibleBuiltinIds] = React.useState<Set<string> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadBuiltinWeChat() {
      try {
        const res = await fetch('/api/apps/builtin/wechat/status', { cache: 'no-store' });
        const json = (await res.json()) as BuiltinWeChatStatus;
        if (!cancelled && res.ok) setWechatStatus(json);
      } catch {
        if (!cancelled) setWechatStatus(null);
      }
    }
    async function loadBuiltinGoofish() {
      try {
        const res = await fetch('/api/apps/builtin/goofish/status', { cache: 'no-store' });
        const json = (await res.json()) as BuiltinGoofishStatus;
        if (!cancelled && res.ok) setGoofishStatus(json);
      } catch {
        if (!cancelled) setGoofishStatus(null);
      }
    }
    async function loadBuiltinEcommerce() {
      try {
        const res = await fetch('/api/apps/builtin/ecommerce/status', { cache: 'no-store' });
        const json = (await res.json()) as BuiltinEcommerceStatus;
        if (!cancelled && res.ok) setEcommerceStatus(json);
      } catch {
        if (!cancelled) setEcommerceStatus(null);
      }
    }
    async function loadBuiltinDouyinCollector() {
      try {
        const res = await fetch('/api/apps/builtin/douyin-collector/status', {
          cache: 'no-store',
        });
        const json = (await res.json()) as BuiltinDouyinCollectorStatus;
        if (!cancelled && res.ok) setDouyinCollectorStatus(json);
      } catch {
        if (!cancelled) setDouyinCollectorStatus(null);
      }
    }
    async function loadBuiltinDeepResearch() {
      try {
        const res = await fetch('/api/apps/builtin/deep-research/status', {
          cache: 'no-store',
        });
        const json = (await res.json()) as BuiltinDeepResearchStatus;
        if (!cancelled && res.ok) setDeepResearchStatus(json);
      } catch {
        if (!cancelled) setDeepResearchStatus(null);
      }
    }
    async function loadBuiltinXRadar() {
      try {
        const res = await fetch('/api/apps/builtin/x-radar/status', { cache: 'no-store' });
        const json = (await res.json()) as BuiltinXRadarStatus;
        if (!cancelled && res.ok) setXRadarStatus(json);
      } catch {
        if (!cancelled) setXRadarStatus(null);
      }
    }
    async function loadVisibility() {
      try {
        const res = await fetch('/api/apps/builtin/visibility', { cache: 'no-store' });
        const json = (await res.json()) as { apps?: Array<{ id: string; visible: boolean }> };
        if (!cancelled && res.ok && Array.isArray(json.apps)) {
          setVisibleBuiltinIds(
            new Set(json.apps.filter((a) => a.visible).map((a) => a.id)),
          );
        }
      } catch {
        if (!cancelled) {
          // Opt-in safe default: if the visibility lookup fails entirely, show
          // nothing rather than leak apps the admin would have hidden.
          setVisibleBuiltinIds(new Set());
        }
      }
      // Quietly pull the latest admin-configured visibility in the background.
      // Don't await — page renders immediately with cached state, then re-renders
      // when the refresh completes.
      void (async () => {
        try {
          const r = await fetch('/api/apps/builtin/visibility/refresh', { method: 'POST' });
          if (!r.ok) return;
          const j = (await r.json()) as { apps?: Array<{ id: string; visible: boolean }> };
          if (cancelled || !Array.isArray(j.apps)) return;
          setVisibleBuiltinIds(
            new Set(j.apps.filter((a) => a.visible).map((a) => a.id)),
          );
        } catch {
          // ignore — keep cached state
        }
      })();
    }
    void loadBuiltinWeChat();
    void loadBuiltinGoofish();
    void loadBuiltinEcommerce();
    void loadBuiltinDouyinCollector();
    void loadBuiltinDeepResearch();
    void loadBuiltinXRadar();
    void loadVisibility();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lumos</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">应用</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="text-foreground tabular-nums">{visibleBuiltinIds?.size ?? 5}</span> 内置
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-8">
        {/*
          Builtin cards: only render once visibility has loaded so we don't
          flash all 3 then collapse to 0/1/2. While visibility is null, show
          a low-key skeleton row.
        */}
        {visibleBuiltinIds === null ? (
          <BuiltinSkeletonRow />
        ) : visibleBuiltinIds.size > 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visibleBuiltinIds.has('wechat-assistant') ? (
              <BuiltinWeChatCard status={wechatStatus} />
            ) : null}
            {visibleBuiltinIds.has('goofish-assistant') ? (
              <BuiltinGoofishCard status={goofishStatus} />
            ) : null}
            {visibleBuiltinIds.has('ecommerce-assistant') ? (
              <BuiltinEcommerceCard status={ecommerceStatus} />
            ) : null}
            {visibleBuiltinIds.has('douyin-collector') ? (
              <BuiltinDouyinCollectorCard status={douyinCollectorStatus} />
            ) : null}
            {visibleBuiltinIds.has('deep-research') ? (
              <BuiltinDeepResearchCard status={deepResearchStatus} />
            ) : null}
            {visibleBuiltinIds.has('etsy-erank') ? <BuiltinEtsyErankCard /> : null}
            {visibleBuiltinIds.has('pinterest-radar') ? <BuiltinPinterestRadarCard /> : null}
            {visibleBuiltinIds.has('x-radar') ? (
              <BuiltinXRadarCard status={xRadarStatus} />
            ) : null}
            {visibleBuiltinIds.has('mesh-trading-team') ? <BuiltinMeshTradingTeamCard /> : null}
            {visibleBuiltinIds.has('etsy-forge') ? <BuiltinEtsyForgeCard /> : null}
          </div>
        ) : (
          <EmptyAppsHint />
        )}
      </div>
    </div>
  );
}

function BuiltinSkeletonRow() {
  // Two pulsing placeholder cards while we wait for the visibility lookup
  // (cached read returns within ~50ms; first-time server fetch can take ~500ms).
  // Two columns matches the lg:grid-cols-2 layout below so the layout doesn't
  // jump when the real cards land.
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[140px] rounded-2xl bg-card ring-1 ring-border/50 p-6 animate-pulse"
        >
          <div className="flex items-start gap-4">
            <div className="size-12 shrink-0 rounded-xl bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted/60" />
            </div>
          </div>
          <div className="mt-4 h-3 w-3/4 rounded bg-muted/60" />
          <div className="mt-2 h-3 w-1/2 rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}

function EmptyAppsHint() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/30 px-6 py-16 text-center">
      <p className="text-base font-medium">暂时没有可用应用</p>
      <p className="max-w-md text-sm text-muted-foreground">
        管理员还没有为你开通任何内置应用。如需使用，请联系管理员开通。
      </p>
    </div>
  );
}
