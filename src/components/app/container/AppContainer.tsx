'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import type { AppPage, AppRoutes, AppManifest, MenuItem } from '@/lib/app/manifest/types';
import type { NativeAppSpecForUi } from '@/lib/app/native-spec';
import type { NativeAppStatusSummary } from '@/lib/app/status-service';

import type { RendererBridge } from '../declarative/bridge';
import { PageRenderer } from '../declarative/PageRenderer';

import { AppAcceptancePanel } from './AppAcceptancePanel';
import { AppAssistantPanel } from './AppAssistantPanel';
import { AppSidebar } from './AppSidebar';

export interface AppContainerProps {
  manifest: AppManifest;
  routes: AppRoutes;
  /** Lookup by route page reference, e.g. "pages/customers.json". */
  pages: Record<string, AppPage>;
  bridge: RendererBridge;
  /** Non-secret config map, prefetched from main process. */
  config?: Record<string, string>;
  user?: Record<string, unknown>;
  status?: NativeAppStatusSummary | null;
  nativeSpec?: NativeAppSpecForUi | null;
}

export function AppContainer({
  manifest,
  routes,
  pages,
  bridge,
  config,
  user,
  status,
  nativeSpec,
}: AppContainerProps): React.ReactElement {
  const initialId = routes.default && routes.menu.some((m) => m.id === routes.default)
    ? routes.default
    : routes.menu[0]?.id;
  const [activeId, setActiveId] = React.useState<string>(initialId);

  const navigationBridge: RendererBridge = React.useMemo(
    () => ({
      ...bridge,
      navigate: (menuId: string) => {
        if (routes.menu.some((m) => m.id === menuId)) {
          setActiveId(menuId);
        } else {
          bridge.navigate(menuId);
        }
      },
    }),
    [bridge, routes.menu],
  );

  const activeItem: MenuItem | undefined = routes.menu.find((m) => m.id === activeId);
  const activePage: AppPage | undefined = activeItem?.page ? pages[activeItem.page] : undefined;

  return (
    <div className="flex h-full">
      <AppSidebar menu={routes.menu} activeId={activeId} onSelect={setActiveId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppStatusStrip status={status} />
        <AppAcceptancePanel
          acceptance={nativeSpec?.acceptance ?? []}
          bridge={navigationBridge}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeItem && activeItem.component ? (
            <div className="p-6 text-sm text-muted-foreground">
              代码组件 <code>{activeItem.component}</code>{' '}
              尚未支持（M6+）。请改用声明式页面。
            </div>
          ) : activePage ? (
            <PageRenderer
              page={activePage}
              bridge={navigationBridge}
              appId={manifest.id}
              user={user}
              config={config}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              未找到页面：{activeItem?.page}
            </div>
          )}
        </div>
        <AppAssistantPanel appId={manifest.id} manifest={manifest} status={status} />
      </div>
    </div>
  );
}

function AppStatusStrip({
  status,
}: {
  status?: NativeAppStatusSummary | null;
}): React.ReactElement | null {
  if (!status) return null;
  const extraMissing = status.missingCapabilities.filter((item) => item !== status.message);
  return (
    <div className="border-b bg-background px-4 py-2 text-xs">
      <div className="flex min-h-6 items-center gap-3">
        <Badge variant={statusBadgeVariant(status.status)}>{status.label}</Badge>
        <div className="min-w-0 flex-1 truncate text-muted-foreground">
          {status.message}
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-muted-foreground sm:flex">
          <span>设置 {status.counts.settings}</span>
          <span>运行 {status.counts.runHistory}</span>
          {status.counts.acceptanceTotal > 0 ? (
            <span>
              验收 {status.counts.acceptancePassed}/{status.counts.acceptanceTotal}
            </span>
          ) : null}
          {status.counts.failedRuns > 0 ? <span>失败 {status.counts.failedRuns}</span> : null}
          {status.counts.acceptanceIssues > 0 ? <span>验收异常 {status.counts.acceptanceIssues}</span> : null}
        </div>
      </div>
      {extraMissing.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1 pl-0 text-[11px] text-muted-foreground sm:pl-[4.5rem]">
          {extraMissing.slice(0, 4).map((item) => (
            <span key={item} className="rounded border bg-muted/40 px-2 py-0.5">
              {item}
            </span>
          ))}
          {extraMissing.length > 4 ? (
            <span className="rounded border bg-muted/40 px-2 py-0.5">
              还有 {extraMissing.length - 4} 项
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function statusBadgeVariant(
  status: NativeAppStatusSummary['status'],
): React.ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'ready':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'running':
      return 'default';
    case 'not_configured':
    case 'not_connected':
      return 'outline';
  }
}
