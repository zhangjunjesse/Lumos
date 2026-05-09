'use client';

import * as React from 'react';

import { Switch } from '@/components/ui/switch';

interface VisibilityEntry {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  defaultVisible: boolean;
  hiddenByUser: boolean;
  hiddenByServer: boolean;
}

export function BuiltinAppsSection(): React.ReactElement {
  const [entries, setEntries] = React.useState<VisibilityEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/apps/builtin/visibility', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as {
        apps?: VisibilityEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? '加载失败');
      setEntries(json.apps ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (id: string, nextVisible: boolean) => {
    setSaving(id);
    setError(null);
    // Optimistic: flip only the user-side flag. Server-side hide is read-only
    // here — we never overwrite admin's choice from a local toggle.
    const optimistic = entries.map((e) =>
      e.id === id
        ? { ...e, hiddenByUser: !nextVisible, visible: nextVisible && !e.hiddenByServer }
        : e,
    );
    setEntries(optimistic);
    try {
      const hiddenByUser = optimistic.filter((e) => e.hiddenByUser).map((e) => e.id);
      const res = await fetch('/api/apps/builtin/visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: hiddenByUser }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        apps?: VisibilityEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? '保存失败');
      if (json.apps) setEntries(json.apps);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      // rollback by re-fetching authoritative state from server
      void load();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/50 p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium">内置应用显示</h2>
          <p className="text-xs text-muted-foreground">
            控制「应用」首页显示哪些内置卡片。关闭后只是隐藏入口，IM 通知、MCP、自动化、底层数据都不受影响。
          </p>
        </div>
      </div>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">加载中…</p>
      ) : error ? (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">没有内置应用。</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {entries.map((entry) => {
            // When the admin has hidden this app server-side the toggle is locked
            // showing the admin state; user can't override.
            const lockedByAdmin = entry.hiddenByServer;
            // Switch reflects the user's intent; if admin locked it, the
            // displayed value is forced off and uneditable.
            const displayChecked = lockedByAdmin ? false : !entry.hiddenByUser;
            return (
              <li
                key={entry.id}
                className={`flex items-start justify-between gap-4 rounded-md border p-3 ${
                  lockedByAdmin ? 'border-amber-300/50 bg-amber-50/30 dark:bg-amber-950/10' : 'bg-card/50'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
                  {lockedByAdmin ? (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      管理员已禁用
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={displayChecked}
                  onCheckedChange={(checked) => void toggle(entry.id, checked)}
                  disabled={saving === entry.id || lockedByAdmin}
                  aria-label={`显示 ${entry.name}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
