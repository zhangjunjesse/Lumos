'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus } from 'lucide-react';
import { AddProviderDialog } from '../AddProviderDialog';
import { ProviderRow } from './ProviderRow';
import { ProviderEditorDialog } from './ProviderEditorDialog';
import { ProviderDeleteDialog } from './ProviderDeleteDialog';
import { useLocalAuth } from './useLocalAuth';
import {
  isSystemProvider,
  matchesCapabilityFilter,
  type CapabilityFilter,
  type SavedConfig,
} from './shared';

interface Props {
  embedded?: boolean;
  capabilityFilter?: CapabilityFilter;
  /** When true, hide add/edit/delete controls. System-origin providers are
   *  always read-only regardless of this flag. */
  readOnly?: boolean;
}

function useProviderList() {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [defaultId, setDefaultId] = useState('');
  const [loading, setLoading] = useState(true);
  const localAuth = useLocalAuth();
  const { primeFromList } = localAuth;

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const providers: SavedConfig[] = data.providers || [];
      setConfigs(providers);
      setDefaultId(data.default_provider_id || '');
    } catch (error) {
      console.error('Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Priming local-auth status is split off so `fetchConfigs` doesn't depend on
  // the unstable `localAuth` object — otherwise every setStatuses inside
  // primeFromList would recreate fetchConfigs and re-fire the mount effect,
  // flooding /api/providers and /api/providers/:id/auth/status.
  useEffect(() => {
    void primeFromList(configs);
  }, [configs, primeFromList]);

  useEffect(() => {
    fetchConfigs();
    const handler = () => fetchConfigs();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchConfigs]);

  return { configs, defaultId, loading, fetchConfigs, localAuth };
}

export function ProviderListCard({ embedded = false, capabilityFilter, readOnly = false }: Props) {
  const { configs, defaultId, loading, fetchConfigs, localAuth } = useProviderList();

  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedConfig | null>(null);

  const filtered = useMemo(
    () => configs.filter(
      (c) => matchesCapabilityFilter(c, capabilityFilter) && (!readOnly || isSystemProvider(c)),
    ),
    [configs, capabilityFilter, readOnly],
  );
  const activeConfig = filtered.find((c) => c.id === defaultId) || null;
  const inactiveConfigs = filtered.filter((c) => c.id !== activeConfig?.id);

  const handleSwitch = async (id: string) => {
    setSwitching(id);
    setSwitchError('');
    try {
      const res = await fetch(`/api/providers/${id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });
      if (res.ok) {
        await fetchConfigs();
        window.dispatchEvent(new Event('provider-changed'));
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSwitchError(data.error || '切换失败');
      }
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '切换失败');
    } finally {
      setSwitching(null);
    }
  };

  const handleSaved = async () => {
    await fetchConfigs();
    window.dispatchEvent(new Event('provider-changed'));
  };

  const handleDeleted = async () => {
    setDeleteTarget(null);
    await fetchConfigs();
    window.dispatchEvent(new Event('provider-changed'));
  };

  const content = loading ? (
    <div className="py-8 flex justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="text-sm font-medium">已添加的服务</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {readOnly ? '管理员配置的 AI 服务，可切换使用' : '管理对话使用的 AI 服务连接'}
          </p>
        </div>
        {filtered.length > 0 && (
          <Badge variant="secondary" className="text-xs">{filtered.length} 个</Badge>
        )}
      </div>

      {switchError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 mt-2">
          <p className="text-xs text-destructive">{switchError}</p>
        </div>
      )}

      <div className="space-y-3 pt-3">
        {activeConfig && (
          <ProviderRow
            config={activeConfig}
            isActive
            readOnly={readOnly}
            switching={false}
            localAuthStatus={localAuth.statuses[activeConfig.id]}
            onSwitch={() => {}}
            onEdit={() => setEditingConfig(activeConfig)}
            onDelete={() => setDeleteTarget(activeConfig)}
          />
        )}

        {inactiveConfigs.length > 0 && (
          <div className="space-y-3">
            {inactiveConfigs.map((config) => (
              <ProviderRow
                key={config.id}
                config={config}
                isActive={false}
                readOnly={readOnly}
                switching={switching === config.id}
                localAuthStatus={localAuth.statuses[config.id]}
                onSwitch={() => handleSwitch(config.id)}
                onEdit={() => setEditingConfig(config)}
                onDelete={() => setDeleteTarget(config)}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {readOnly ? '管理员尚未配置任何 AI 服务' : '还没有添加 AI 服务'}
            </p>
            {!readOnly && (
              <p className="text-xs text-muted-foreground/60">
                点击下方添加你的第一个 AI 服务
              </p>
            )}
          </div>
        )}

        {!readOnly && (
          <Button
            variant="outline"
            className="w-full justify-center gap-2 text-sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            添加服务
          </Button>
        )}
      </div>
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="space-y-2">{content}</div>
      ) : (
        <Card className="border-border/50">
          <CardContent className="space-y-2 pt-6">{content}</CardContent>
        </Card>
      )}

      <AddProviderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        requiredCapability={capabilityFilter === 'agent-chat' ? 'agent-chat' : null}
        title="添加 AI 服务"
        description="选择一个模板快速创建，创建后可继续编辑连接信息和模型列表。"
        onCreated={handleSaved}
      />

      <ProviderEditorDialog
        open={!!editingConfig}
        config={editingConfig}
        onOpenChange={(open) => {
          if (!open) setEditingConfig(null);
        }}
        onSaved={handleSaved}
      />

      <ProviderDeleteDialog
        target={deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onDeleted={handleDeleted}
      />
    </>
  );
}
