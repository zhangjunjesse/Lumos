'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InstallDialog } from '@/components/app/install-flow/InstallDialog';
import {
  BuiltinEcommerceCard,
  BuiltinGoofishCard,
  BuiltinWeChatCard,
} from '@/components/apps/list/BuiltinAppCard';
import { DraftCard } from '@/components/apps/list/DraftCard';
import { InstalledAppCard } from '@/components/apps/list/InstalledAppCard';
import { NewAppDialog, type BuilderTemplate } from '@/components/apps/list/NewAppDialog';
import { useAppInstall } from '@/components/apps/list/use-app-install';

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

export default function AppsListPage(): React.ReactElement {
  const router = useRouter();

  const [apps, setApps] = React.useState<ListedApp[]>([]);
  const [drafts, setDrafts] = React.useState<ListedDraft[]>([]);
  const [wechatStatus, setWechatStatus] = React.useState<BuiltinWeChatStatus | null>(null);
  const [goofishStatus, setGoofishStatus] = React.useState<BuiltinGoofishStatus | null>(null);
  const [ecommerceStatus, setEcommerceStatus] = React.useState<BuiltinEcommerceStatus | null>(null);
  const [visibleBuiltinIds, setVisibleBuiltinIds] = React.useState<Set<string> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState('blank');
  const [templates, setTemplates] = React.useState<BuilderTemplate[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

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

  const install = useAppInstall(load);

  React.useEffect(() => {
    void load();
  }, [load]);

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
    void loadVisibility();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!createOpen || templates.length > 0) return;
    let cancelled = false;
    async function loadTemplates() {
      try {
        const res = await fetch('/api/apps/builder/templates');
        const json = (await res.json()) as { templates?: BuilderTemplate[] };
        if (!cancelled) setTemplates(json.templates ?? []);
      } catch {
        if (!cancelled) setTemplates([]);
      }
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [createOpen, templates.length]);

  const openCreate = () => {
    setNewName('');
    setNewDescription('');
    setSelectedTemplateId('blank');
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
          templateId: selectedTemplateId,
        }),
      });
      const json = (await res.json()) as { session?: { id: string }; error?: string };
      if (!res.ok || !json.session?.id) {
        setCreateError(json.error ?? '创建失败');
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

  const handleUninstall = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`卸载 ${id}？用户数据保留。`)) return;
    const res = await fetch(`/api/apps/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      window.alert(`卸载失败：${json.error ?? '未知错误'}`);
      return;
    }
    await load();
  };

  const handleDeleteDraft = async (sessionId: string) => {
    if (typeof window !== 'undefined' && !window.confirm('删除草稿？')) return;
    const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      window.alert(`删除失败：${json.error ?? '未知错误'}`);
      return;
    }
    await load();
  };

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lumos</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">应用</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="text-foreground tabular-nums">{visibleBuiltinIds?.size ?? 3}</span> 内置
            {drafts.length > 0 ? <> · <span className="text-foreground tabular-nums">{drafts.length}</span> 草稿</> : null}
            {apps.length > 0 ? <> · <span className="text-foreground tabular-nums">{apps.length}</span> 已安装</> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={openCreate} size="sm">
            <Plus />
            新建
          </Button>
          <Button variant="outline" size="sm" disabled={install.installing} asChild>
            <label className="cursor-pointer">
              <Upload />
              {install.installing ? '处理中…' : '导入'}
              <input
                type="file"
                accept=".lumos-app,application/zip"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await install.handleFile(file);
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
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visibleBuiltinIds === null || visibleBuiltinIds.has('wechat-assistant') ? (
              <BuiltinWeChatCard status={wechatStatus} />
            ) : null}
            {visibleBuiltinIds === null || visibleBuiltinIds.has('goofish-assistant') ? (
              <BuiltinGoofishCard status={goofishStatus} />
            ) : null}
            {visibleBuiltinIds === null || visibleBuiltinIds.has('ecommerce-assistant') ? (
              <BuiltinEcommerceCard status={ecommerceStatus} />
            ) : null}
          </div>

          {drafts.length > 0 ? (
            <Section title="草稿" count={drafts.length}>
              {drafts.map((d) => (
                <DraftCard key={d.sessionId} draft={d} onDelete={handleDeleteDraft} />
              ))}
            </Section>
          ) : null}

          {apps.length > 0 ? (
            <Section title="已安装" count={apps.length}>
              {apps.map((a) => (
                <InstalledAppCard key={a.id} app={a} onUninstall={handleUninstall} />
              ))}
            </Section>
          ) : null}
        </div>
      )}

      <NewAppDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        newName={newName}
        newDescription={newDescription}
        selectedTemplateId={selectedTemplateId}
        creating={creating}
        createError={createError}
        onNameChange={setNewName}
        onDescriptionChange={setNewDescription}
        onSelectTemplate={setSelectedTemplateId}
        onSubmit={handleCreate}
        inputRef={nameInputRef}
      />

      <InstallDialog
        open={install.pendingRequest !== null}
        request={install.pendingRequest}
        onConfirm={install.handleConsent}
        onCancel={install.cancelConsent}
      />
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}
