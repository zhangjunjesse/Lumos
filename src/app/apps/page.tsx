'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InstallDialog } from '@/components/app/install-flow/InstallDialog';
import type {
  ConsentRequest,
  ConsentResponse,
  InstalledApp,
} from '@/lib/app/installer';

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

interface ListedDraft {
  sessionId: string;
  name: string;
  description: string;
  status: string;
  updatedAt: number;
}

export default function AppsListPage(): React.ReactElement {
  const router = useRouter();

  const [apps, setApps] = React.useState<ListedApp[]>([]);
  const [drafts, setDrafts] = React.useState<ListedDraft[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // ----- Create-app dialog state -----
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  // ----- Local-package install + consent -----
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [pendingRequest, setPendingRequest] = React.useState<ConsentRequest | null>(null);
  const [installing, setInstalling] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/apps');
      const json = (await res.json()) as {
        apps?: ListedApp[];
        drafts?: ListedDraft[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setApps(json.apps ?? []);
      setDrafts(json.drafts ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // ---------- create app ----------

  const openCreate = () => {
    setNewName('');
    setNewDescription('');
    setCreateError(null);
    setCreateOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError('请填写应用名');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/apps/builder/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: name,
          appDescription: newDescription.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        session?: { id: string };
        error?: string;
      };
      if (!res.ok || !json.session?.id) {
        setCreateError(json.error ?? '创建失败，请重试');
        return;
      }
      setCreateOpen(false);
      router.push(`/apps/builder/${json.session.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // ---------- local-package install (existing flow) ----------

  const performUpload = React.useCallback(
    async (file: File, consent: ConsentResponse | null) => {
      const form = new FormData();
      form.append('file', file);
      form.append('source', 'local');
      if (consent) form.append('consent', JSON.stringify(consent));

      const res = await fetch('/api/apps', { method: 'POST', body: form });
      const json = (await res.json()) as {
        ok?: boolean;
        installed?: InstalledApp;
        error?: string;
        message?: string;
        needsConsent?: boolean;
        request?: ConsentRequest;
      };
      if (json.needsConsent && json.request) {
        return { kind: 'needs-consent' as const, request: json.request };
      }
      if (!res.ok || json.ok === false) {
        return {
          kind: 'error' as const,
          message: json.message ?? json.error ?? `HTTP ${res.status}`,
        };
      }
      return { kind: 'ok' as const, installed: json.installed };
    },
    [],
  );

  const handleFile = async (file: File) => {
    setInstalling(true);
    try {
      const res = await performUpload(file, null);
      if (res.kind === 'needs-consent') {
        setPendingFile(file);
        setPendingRequest(res.request);
      } else if (res.kind === 'ok') {
        await load();
      } else {
        window.alert(`安装失败：${res.message}`);
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleConsent = async (response: ConsentResponse) => {
    if (!pendingFile) return;
    setInstalling(true);
    try {
      const res = await performUpload(pendingFile, response);
      setPendingFile(null);
      setPendingRequest(null);
      if (res.kind === 'ok') {
        await load();
      } else if (res.kind === 'error') {
        window.alert(`安装失败：${res.message}`);
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleCancelConsent = () => {
    setPendingFile(null);
    setPendingRequest(null);
  };

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

  const handleDeleteDraft = async (sessionId: string) => {
    if (typeof window !== 'undefined' && !window.confirm('删除草稿？相关对话与文件也会一并丢弃。')) return;
    const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      window.alert(`删除失败：${json.error ?? '未知错误'}`);
      return;
    }
    await load();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">应用</h1>
        <div className="flex gap-2">
          <Button onClick={openCreate}>+ 新建应用</Button>
          <Button variant="outline" disabled={installing} asChild>
            <label className="cursor-pointer">
              {installing ? '处理中…' : '导入本地包…'}
              <input
                type="file"
                accept=".lumos-app,application/zip"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await handleFile(file);
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
      ) : apps.length === 0 && drafts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-base font-medium">还没有任何应用</p>
            <p className="text-sm text-muted-foreground">
              点上方「+ 新建应用」由 AI 协助生成，或导入一个本地 .lumos-app 包。
            </p>
            <Button onClick={openCreate} className="mt-2">
              + 新建应用
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {drafts.map((d) => (
            <Card key={`draft:${d.sessionId}`} className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{d.name}</span>
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                    草稿
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="line-clamp-2 min-h-[2.5em] text-sm text-muted-foreground">
                  {d.description || '尚未填写描述'}
                </p>
                <div className="text-xs text-muted-foreground">
                  最近编辑：{new Date(d.updatedAt).toLocaleString()}
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm">
                    <Link href={`/apps/builder/${d.sessionId}`}>继续编辑</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteDraft(d.sessionId)}
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {apps.map((a) => (
            <Card key={`app:${a.id}`} className={a.enabled ? '' : 'opacity-60'}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{a.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    v{a.version}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{labelSource(a.source)}</span>
                  {a.lastUsedAt ? (
                    <span>最近使用 {new Date(a.lastUsedAt).toLocaleString()}</span>
                  ) : (
                    <span>未使用</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm">
                    <Link href={`/apps/${a.id}`}>打开</Link>
                  </Button>
                  <Button
                    variant="ghost"
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

      {/* New-app dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!creating) setCreateOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建应用</DialogTitle>
            <DialogDescription>
              先给应用起个名字和简短描述。进入下一步后，AI 会跟你对话，逐步把它做出来。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="app-name">
                应用名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="app-name"
                ref={nameInputRef}
                placeholder="例如：客户管理、周报助手、合同审查"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creating) void handleCreate();
                }}
                maxLength={64}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="app-description">描述</Label>
              <Textarea
                id="app-description"
                placeholder="一句话说明这个应用做什么、给谁用。AI 会基于这段描述跟你确认细节。"
                rows={3}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            {createError ? (
              <p className="text-sm text-destructive">{createError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? '创建中…' : '下一步'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InstallDialog
        open={pendingRequest !== null}
        request={pendingRequest}
        onConfirm={handleConsent}
        onCancel={handleCancelConsent}
      />
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
