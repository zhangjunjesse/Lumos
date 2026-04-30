'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';

import { AppContainer } from '@/components/app/container/AppContainer';
import type { RendererBridge } from '@/components/app/declarative/bridge';
import type { AppManifest, AppPage, AppRoutes } from '@/lib/app/manifest/types';

interface AppDetailResponse {
  id: string;
  name: string;
  version: string;
  installPath: string;
  manifest: AppManifest;
}

export default function AppEntryPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const appId = params?.id ?? '';

  const [detail, setDetail] = React.useState<AppDetailResponse | null>(null);
  // routes / pages will be populated once the assets route ships in M2.
  const [routes] = React.useState<AppRoutes | null>(null);
  const [pages] = React.useState<Record<string, AppPage>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function load() {
      try {
        const detailRes = await fetch(`/api/apps/${appId}`);
        if (!detailRes.ok) throw new Error(`Detail fetch failed: ${detailRes.status}`);
        const detailJson = (await detailRes.json()) as { app: AppDetailResponse };
        setDetail(detailJson.app);

        // For now, the page renderer reads routes/pages from the install dir
        // via a dedicated assets route. v1 ships a simple inline read by
        // re-using the manifest table — real implementation lands with the
        // /api/apps/<id>/assets endpoint in M2. For dev preview we surface
        // a clear error.
        setError(
          'M1 状态：应用入口页 UI 已就位，但 routes.json / pages/*.json 的资源路由 ' +
            '(/api/apps/<id>/assets/*) 计划在 M2 实装。当前只能展示 manifest 元信息。',
        );
      } catch (err) {
        setError((err as Error).message);
      }
    }
    if (appId) void load();
  }, [appId]);

  const bridge = useMockBridge();

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">{detail?.name ?? appId}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{error}</p>
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
      bridge={bridge}
    />
  );
}

/** Wire the bridge to /api/apps/<id>/* routes. */
function useMockBridge(): RendererBridge {
  // Wired in M2 with real fetch calls; for now use noop stubs so the
  // component compiles and renders without crashing if fed mock data.
  return React.useMemo<RendererBridge>(
    () => ({
      runWorkflow: async () => ({
        output: null,
        status: 'failed',
        error: 'workflow runtime integration is M3',
      }),
      dbQuery: async () => [],
      dbGet: async () => null,
      dbCount: async () => 0,
      dbCreate: async (_c, data) => ({ ...data, id: 'stub-id' }),
      dbUpdate: async () => null,
      dbDelete: async () => false,
      configGet: async () => null,
      navigate: () => undefined,
      openDialog: () => undefined,
      toast: () => undefined,
      confirm: async () => true,
    }),
    [],
  );
}
