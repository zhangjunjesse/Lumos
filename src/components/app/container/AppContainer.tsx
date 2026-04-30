'use client';

import * as React from 'react';

import type { AppPage, AppRoutes, AppManifest, MenuItem } from '@/lib/app/manifest/types';

import type { RendererBridge } from '../declarative/bridge';
import { PageRenderer } from '../declarative/PageRenderer';

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
}

export function AppContainer({
  manifest,
  routes,
  pages,
  bridge,
  config,
  user,
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
      <div className="flex-1 overflow-y-auto">
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
    </div>
  );
}
