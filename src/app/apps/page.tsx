'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ListedApp {
  id: string;
  name: string;
  version: string;
  source: string;
  enabled: boolean;
  installedAt: number;
  lastUsedAt: number | null;
  sizeBytes: number | null;
}

export default function AppsListPage(): React.ReactElement {
  const [apps, setApps] = React.useState<ListedApp[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/apps');
      const json = (await res.json()) as { apps?: ListedApp[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setApps(json.apps ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleUninstall = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`确定卸载应用 ${id} 吗？\n用户数据将默认保留。`)) return;
    const res = await fetch(`/api/apps/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      window.alert(`卸载失败：${json.error ?? '未知错误'}`);
      return;
    }
    await load();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">应用</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              安装本地包…
              <input
                type="file"
                accept=".lumos-app,application/zip"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append('file', file);
                  form.append('source', 'local');
                  const res = await fetch('/api/apps', { method: 'POST', body: form });
                  const json = (await res.json()) as {
                    ok?: boolean;
                    error?: string;
                    message?: string;
                    needsConsent?: boolean;
                  };
                  if (!res.ok && !json.needsConsent) {
                    window.alert(`安装失败：${json.message ?? json.error ?? '未知错误'}`);
                  } else if (json.needsConsent) {
                    // Re-upload with full consent for now (no UI modal here yet).
                    // The renderer's InstallDialog (src/components/app/install-flow)
                    // is designed for this; wire-up lands when navigation finishes.
                    window.alert('该应用需要授权确认，请暂时跳过；交互式弹窗将在后续接入。');
                  }
                  await load();
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </Button>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-base font-medium">还没有任何应用</p>
            <p className="text-sm text-muted-foreground">
              用 AI 创建器对话生成、把 workflow 一键转换，或导入本地 .lumos-app 安装包。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {apps.map((a) => (
            <Card key={a.id} className={a.enabled ? '' : 'opacity-60'}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{a.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    v{a.version}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>来源：{labelSource(a.source)}</span>
                  {a.lastUsedAt ? (
                    <span>最近使用：{new Date(a.lastUsedAt).toLocaleString()}</span>
                  ) : (
                    <span>未使用</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm">
                    <a href={`/apps/${a.id}`}>打开</a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUninstall(a.id)}
                  >
                    卸载
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function labelSource(s: string): string {
  switch (s) {
    case 'ai-generated':
      return 'AI 生成';
    case 'workflow-promoted':
      return '工作流转换';
    case 'local':
      return '本地导入';
    case 'builtin':
      return '内置';
    case 'market':
      return '市场';
    default:
      return s;
  }
}
