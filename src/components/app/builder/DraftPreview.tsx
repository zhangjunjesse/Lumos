'use client';

import * as React from 'react';
import { Monitor, Smartphone, Tablet } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppContainer } from '@/components/app/container/AppContainer';
import { createStubRendererBridge } from '@/components/app/declarative/bridge';
import { SandboxIframe } from '@/components/app/sandbox/SandboxIframe';
import type { BuilderArtifact } from '@/lib/app/builder/session';
import type { AppManifest, AppPage, AppRoutes } from '@/lib/app/manifest/types';
import type { ManifestV2 } from '@/lib/app/compile/types';
import { builderAppId } from '@/lib/app/sandbox/app-id';
import { createApiAdapters } from '@/lib/app/sandbox/api-adapters';
import { cn } from '@/lib/utils';

interface DraftPreviewProps {
  artifacts: BuilderArtifact[];
  appName: string;
  description?: string;
  className?: string;
  /** Required for v2 react sandbox previews. */
  sessionId?: string;
}

interface ParsedDraft {
  manifest: AppManifest | null;
  routes: AppRoutes | null;
  pages: Record<string, AppPage>;
  dataSchema: Record<string, unknown> | null;
  parseErrors: Array<{ path: string; message: string }>;
}

type ViewportMode = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_CLASS: Record<ViewportMode, string> = {
  desktop: 'w-full max-w-[1180px]',
  tablet: 'w-[820px] max-w-full',
  mobile: 'w-[390px] max-w-full',
};

export function DraftPreview({
  artifacts,
  className,
  sessionId,
}: DraftPreviewProps): React.ReactElement {
  const v2 = React.useMemo(() => detectV2Manifest(artifacts), [artifacts]);
  const parsed = React.useMemo(() => parseDraft(artifacts), [artifacts]);
  const [viewport, setViewport] = React.useState<ViewportMode>('desktop');
  const bridge = React.useMemo(() => {
    const stub = createStubRendererBridge();
    seedCollections(stub, parsed.dataSchema);
    return stub;
  }, [parsed.dataSchema]);
  const artifactsFingerprint = React.useMemo(() => fingerprint(artifacts), [artifacts]);

  // v2 React-in-iframe path: manifest.json with engine="react-v2"
  if (v2 && sessionId) {
    return (
      <SandboxPreview
        sessionId={sessionId}
        manifest={v2}
        artifactsFingerprint={artifactsFingerprint}
        className={className}
      />
    );
  }

  const manifest = parsed.manifest;
  const routes = parsed.routes;

  if (!manifest || !routes || Object.keys(parsed.pages).length === 0) {
    return (
      <div className={cn('h-full min-h-[560px] bg-background', className)} />
    );
  }

  return (
    <div className={cn('flex h-full min-h-[560px] flex-col overflow-hidden bg-muted/30', className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b bg-background px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{manifest.name}</span>
            <Badge variant="secondary">实时画布</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {routes.menu.length} 个页面 · {Object.keys(parsed.pages).length} 个页面文件
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={viewport === 'desktop' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="桌面预览"
            onClick={() => setViewport('desktop')}
          >
            <Monitor />
          </Button>
          <Button
            type="button"
            variant={viewport === 'tablet' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="平板预览"
            onClick={() => setViewport('tablet')}
          >
            <Tablet />
          </Button>
          <Button
            type="button"
            variant={viewport === 'mobile' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="手机预览"
            onClick={() => setViewport('mobile')}
          >
            <Smartphone />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full justify-center p-6">
          <div
            className={cn(
              'h-[760px] overflow-hidden rounded-lg border bg-background shadow-sm',
              VIEWPORT_CLASS[viewport],
            )}
          >
            <AppContainer
              key={`${manifest.id}:${routes.menu.length}:${Object.keys(parsed.pages).length}`}
              manifest={manifest}
              routes={routes}
              pages={parsed.pages}
              bridge={bridge}
            />
          </div>
        </div>
      </ScrollArea>
      {parsed.parseErrors.length > 0 ? (
        <div className="border-t bg-background px-4 py-2 text-xs text-destructive">
          {parsed.parseErrors[0].path}: {parsed.parseErrors[0].message}
        </div>
      ) : null}
    </div>
  );
}

function parseDraft(artifacts: BuilderArtifact[]): ParsedDraft {
  const pages: ParsedDraft['pages'] = {};
  const parseErrors: ParsedDraft['parseErrors'] = [];
  let manifest: AppManifest | null = null;
  let routes: AppRoutes | null = null;
  let dataSchema: Record<string, unknown> | null = null;

  for (const artifact of artifacts) {
    if (artifact.filePath === 'app.json') {
      const parsed = parseJson<AppManifest>(artifact.content);
      if (parsed.ok) manifest = parsed.value;
      else parseErrors.push({ path: artifact.filePath, message: parsed.message });
      continue;
    }
    if (artifact.filePath === 'routes.json') {
      const parsed = parseJson<AppRoutes>(artifact.content);
      if (parsed.ok) routes = parsed.value;
      else parseErrors.push({ path: artifact.filePath, message: parsed.message });
      continue;
    }
    if (artifact.filePath === 'data-schema.json') {
      const parsed = parseJson<Record<string, unknown>>(artifact.content);
      if (parsed.ok) dataSchema = parsed.value;
      else parseErrors.push({ path: artifact.filePath, message: parsed.message });
      continue;
    }
    if (!artifact.filePath.startsWith('pages/') || !artifact.filePath.endsWith('.json')) {
      continue;
    }
    const parsed = parseJson<AppPage>(artifact.content);
    if (parsed.ok) pages[artifact.filePath] = parsed.value;
    else parseErrors.push({ path: artifact.filePath, message: parsed.message });
  }

  return { manifest, routes, pages, dataSchema, parseErrors };
}

function parseJson<T>(content: string): { ok: true; value: T } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(content) as T };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function seedCollections(
  bridge: ReturnType<typeof createStubRendererBridge>,
  dataSchema: Record<string, unknown> | null,
): void {
  const collections = Array.isArray(dataSchema?.collections) ? dataSchema.collections : [];
  for (const collection of collections) {
    if (!isRecord(collection) || typeof collection.name !== 'string') continue;
    const fields = Array.isArray(collection.fields) ? collection.fields.filter(isRecord) : [];
    bridge.seedCollection(
      collection.name,
      Array.from({ length: 4 }, (_, index) => buildSampleRow(fields, index)),
    );
  }
}

function buildSampleRow(
  fields: Record<string, unknown>[],
  index: number,
): Record<string, unknown> & { id: string } {
  const row: Record<string, unknown> & { id: string } = { id: `sample-${index + 1}` };
  for (const field of fields) {
    const name = typeof field.name === 'string' ? field.name : '';
    if (!name || name === 'id') continue;
    row[name] = sampleValue(field, index);
  }
  return row;
}

function sampleValue(field: Record<string, unknown>, index: number): unknown {
  const label = typeof field.label === 'string' ? field.label : field.name;
  switch (field.type) {
    case 'number':
    case 'integer':
      return (index + 1) * 10;
    case 'boolean':
      return index % 2 === 0;
    case 'enum': {
      const options = Array.isArray(field.options) ? field.options : [];
      return String(options[index % Math.max(options.length, 1)] ?? '进行中');
    }
    case 'date':
      return `2026-04-${String(20 + index).padStart(2, '0')}`;
    case 'datetime':
      return `2026-04-${String(20 + index).padStart(2, '0')} 10:00`;
    case 'text':
      return `${label}示例内容 ${index + 1}`;
    default:
      return `${label || '字段'} ${index + 1}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---- v2 react-sandbox preview --------------------------------------------

function detectV2Manifest(artifacts: BuilderArtifact[]): ManifestV2 | null {
  const file = artifacts.find((a) => a.filePath === 'manifest.json');
  if (!file) return null;
  try {
    const parsed = JSON.parse(file.content) as ManifestV2;
    if (parsed?.runtime?.engine === 'react-v2') return parsed;
    return null;
  } catch {
    return null;
  }
}

function fingerprint(artifacts: BuilderArtifact[]): string {
  return artifacts
    .map((a) => `${a.filePath}:${a.version}`)
    .sort()
    .join('|');
}

function SandboxPreview({
  sessionId,
  manifest,
  artifactsFingerprint,
  className,
}: {
  sessionId: string;
  manifest: ManifestV2;
  artifactsFingerprint: string;
  className?: string;
}): React.ReactElement {
  const appId = React.useMemo(() => builderAppId(sessionId), [sessionId]);
  const adapters = React.useMemo(() => createApiAdapters({ appId }), [appId]);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Bump reloadKey whenever artifact set changes so iframe re-fetches.
  React.useEffect(() => {
    setReloadKey((n) => n + 1);
  }, [artifactsFingerprint]);

  return (
    <div className={cn('flex h-full min-h-[560px] flex-col overflow-hidden bg-muted/30', className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b bg-background px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{manifest.name}</span>
            <Badge variant="secondary">React 沙箱</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {manifest.routes.length} 个路由 · {manifest.id}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setReloadKey((n) => n + 1)}
          aria-label="重新加载预览"
        >
          重新加载
        </Button>
      </div>
      <div className="min-h-0 flex-1 bg-background">
        <SandboxIframe
          src={`lumos-app://${appId}/`}
          manifest={manifest}
          adapters={adapters}
          reloadKey={reloadKey}
          className="h-full"
        />
      </div>
    </div>
  );
}
