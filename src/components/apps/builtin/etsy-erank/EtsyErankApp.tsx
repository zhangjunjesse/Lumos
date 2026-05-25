'use client';

import * as React from 'react';
import { Settings } from 'lucide-react';

import { SettingsSheet } from './components/SettingsSheet';
import { ChatDockProvider } from './components/ChatDock';
import { EtsyErankProvider, useEtsyErank } from './use-demo-state';
import { RadarRunsTab } from './tabs/RadarRunsTab';
import { CurrentRunTab } from './tabs/CurrentRunTab';

function Shell(): React.ReactElement {
  const { view, activeRunId, dispatch } = useEtsyErank();
  // 在 currentRun 视图下激活 chat dock(把 runId 给 chat,知道调哪个 endpoint)
  const chatRunId = view === 'current' ? activeRunId : null;
  return (
    <ChatDockProvider runId={chatRunId}>
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Lumos · 内置应用
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
            Etsy eRank 选品雷达
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ②抓种子 → ③扩词 → ④Bulk 验真 → ⑤AI 解读 → ⑥EHunt 商业分析 → ⑦人工验证。不烧配额,不编数字。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ t: 'toggle-settings', v: true })}
            aria-label="设置"
            className="flex size-9 items-center justify-center rounded-xl text-muted-foreground ring-1 ring-border/60 hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {view === 'runs' ? <RadarRunsTab /> : <CurrentRunTab />}

      <SettingsSheet />
    </div>
    </ChatDockProvider>
  );
}

export function EtsyErankApp(): React.ReactElement {
  return (
    <EtsyErankProvider>
      <Shell />
    </EtsyErankProvider>
  );
}
