'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';

import { AppContainer } from '@/components/app/container/AppContainer';
import { createApiRendererBridge } from '@/components/app/declarative/api-bridge';
import type { AppManifest, AppPage, AppRoutes, MenuItem } from '@/lib/app/manifest/types';
import { parseNativeAppSpecForUi, type NativeAppSpecForUi } from '@/lib/app/native-spec';
import type { NativeAppStatusSummary } from '@/lib/app/status-service';

interface AppDetailResponse {
  id: string;
  name: string;
  version: string;
  installPath: string;
  manifest: AppManifest;
}

interface ConfigEntry {
  key: string;
  isSecret: boolean;
  value: string | null;
}

export default function AppEntryPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const appId = params?.id ?? '';

  const [detail, setDetail] = React.useState<AppDetailResponse | null>(null);
  const [routes, setRoutes] = React.useState<AppRoutes | null>(null);
  const [pages, setPages] = React.useState<Record<string, AppPage>>({});
  const [config, setConfig] = React.useState<Record<string, string>>({});
  const [appStatus, setAppStatus] = React.useState<NativeAppStatusSummary | null>(null);
  const [nativeSpec, setNativeSpec] = React.useState<NativeAppSpecForUi | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setNativeSpec(null);
        setAppStatus(null);
        const detailRes = await fetch(`/api/apps/${appId}`);
        if (!detailRes.ok) {
          throw new Error(`Detail fetch failed: ${detailRes.status}`);
        }
        const detailJson = (await detailRes.json()) as { app: AppDetailResponse };
        if (cancelled) return;
        setDetail(detailJson.app);

        const routesRes = await fetch(`/api/apps/${appId}/assets/routes.json`);
        if (!routesRes.ok) {
          throw new Error(`routes.json missing: ${routesRes.status}`);
        }
        const routesJson = (await routesRes.json()) as AppRoutes;
        if (cancelled) return;
        setRoutes(routesJson);

        const pagePaths = collectPagePaths(routesJson.menu);
        const pageEntries = await Promise.all(
          pagePaths.map(async (p) => {
            const segs = p.split('/').filter((s) => s.length > 0);
            const r = await fetch(
              `/api/apps/${appId}/assets/${segs.map(encodeURIComponent).join('/')}`,
            );
            if (!r.ok) throw new Error(`${p} missing: ${r.status}`);
            return [p, (await r.json()) as AppPage] as const;
          }),
        );
        if (cancelled) return;
        setPages(Object.fromEntries(pageEntries));

        try {
          const specRes = await fetch(`/api/apps/${appId}/assets/native-app-spec.json`, {
            cache: 'no-store',
          });
          if (specRes.ok) {
            const specJson = await specRes.json();
            if (cancelled) return;
            setNativeSpec(parseNativeAppSpecForUi(specJson));
          } else if (!cancelled) {
            setNativeSpec(null);
          }
        } catch {
          // native-app-spec.json is optional for older installed apps
        }

        try {
          const statusRes = await fetch(`/api/apps/${appId}/status`, { cache: 'no-store' });
          if (statusRes.ok) {
            const statusJson = (await statusRes.json()) as { status: NativeAppStatusSummary };
            if (cancelled) return;
            setAppStatus(statusJson.status);
          }
        } catch {
          // status is advisory; page rendering should not fail because of it
        }

        // Non-secret config (secrets aren't returned by the API).
        try {
          const cfgRes = await fetch(`/api/apps/${appId}/config`);
          if (cfgRes.ok) {
            const cfgJson = (await cfgRes.json()) as { entries: ConfigEntry[] };
            if (cancelled) return;
            setConfig(
              Object.fromEntries(
                cfgJson.entries
                  .filter((e) => !e.isSecret && typeof e.value === 'string')
                  .map((e) => [e.key, e.value as string]),
              ),
            );
          }
        } catch {
          // config is optional
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    if (appId) void load();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const bridge = React.useMemo(
    () =>
      createApiRendererBridge(appId, {
        navigate: () => {
          // AppContainer overrides navigate for in-app menu items;
          // anything that bubbles up here would be cross-app navigation,
          // which v1 doesn't support.
        },
        openDialog: (dialogId) => {
          // Page-level dialog manager (form-driven create/edit modals)
          // is M2; for now surface a console warning so the intent is
          // visible during dev.
          console.warn(`Dialog '${dialogId}' opened — page-level dialog manager is M2.`);
        },
        toast: ({ title, description, level }) => {
          if (level === 'error' || level === 'warning') {
            window.alert(`${title}${description ? `\n${description}` : ''}`);
          } else {
            console.info(`[toast] ${title}${description ? `: ${description}` : ''}`);
          }
        },
        confirm: async (message) => {
          if (typeof window === 'undefined') return false;
          return window.confirm(message);
        },
      }),
    [appId],
  );

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">{detail?.name ?? appId}</h1>
        <p className="mt-4 text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!detail || !routes) {
    return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;
  }
  return (
    <AppContainer
      manifest={detail.manifest}
      routes={routes}
      pages={pages}
      config={config}
      status={appStatus}
      nativeSpec={nativeSpec}
      bridge={bridge}
    />
  );
}

function collectPagePaths(menu: MenuItem[]): string[] {
  const out = new Set<string>();
  for (const item of menu) {
    if (item.page) out.add(item.page);
  }
  return Array.from(out);
}
