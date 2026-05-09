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
import { NewAppDialog, type BuilderTemplate } from '@/components/apps/list/NewAppDialog';
import { useAppInstall } from '@/components/apps/list/use-app-install';

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
    // The page intentionally no longer renders drafts / installed third-party
    // apps — visibility is fully admin-controlled. Keep a lightweight fetch
    // to gate the loading spinner so cards aren't rendered against an
    // unfetched session.
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/apps');
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? 'Request failed');
      }
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

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lumos</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">应用</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="text-foreground tabular-nums">{visibleBuiltinIds?.size ?? 3}</span> 内置
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
          {/*
            Builtin cards: only render once visibility has loaded so we don't
            flash all 3 then collapse to 0/1/2 (which the user noticed as bad
            UX). While visibility is null, show a low-key skeleton row.
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
            </div>
          ) : (
            <EmptyAppsHint />
          )}
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

