'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { AgentPresetDirectoryItem } from '@/types';
import { AgentPresetEditor, type AgentPresetFormData } from './AgentPresetEditor';

const ROLE_LABELS: Record<string, string> = {
  orchestrator: '编排者',
  lead: '负责人',
  worker: '执行者',
};

const ROLE_COLORS: Record<string, string> = {
  orchestrator: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  lead: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  worker: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function PresetCard({
  preset,
  onEdit,
  onDelete,
}: {
  preset: AgentPresetDirectoryItem;
  onEdit: (p: AgentPresetDirectoryItem) => void;
  onDelete: (id: string) => void;
}) {
  const roleLabel = ROLE_LABELS[preset.roleKind] || preset.roleKind;
  const roleColor = ROLE_COLORS[preset.roleKind] || '';

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="font-medium text-sm truncate">{preset.name}</div>
            {preset.description && (
              <div className="text-xs text-muted-foreground truncate">{preset.description}</div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className={`text-xs ${roleColor}`}>{roleLabel}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-2">
        <p className="text-xs text-muted-foreground line-clamp-2">{preset.responsibility}</p>

        <div className="flex flex-wrap gap-1.5">
          {preset.preferredModel && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {preset.preferredModel}
            </span>
          )}
          {preset.toolPermissions && (
            <>
              {preset.toolPermissions.read && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">read</span>}
              {preset.toolPermissions.write && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">write</span>}
              {preset.toolPermissions.exec && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">exec</span>}
            </>
          )}
          {(preset.mcpServers?.length ?? 0) > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {preset.mcpServers!.length} MCP
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(preset)}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => onDelete(preset.id)}
          >
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AgentPresetList() {
  const [presets, setPresets] = useState<AgentPresetDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentPresetDirectoryItem | null>(null);

  const loadPresets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/agent-presets');
      const data = await res.json();
      setPresets(data.presets || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPresets(); }, [loadPresets]);

  const handleCreate = useCallback(() => {
    setEditTarget(null);
    setEditorOpen(true);
  }, []);

  const handleEdit = useCallback((preset: AgentPresetDirectoryItem) => {
    setEditTarget(preset);
    setEditorOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认删除此 Agent 配置？')) return;
    await fetch(`/api/workflow/agent-presets/${id}`, { method: 'DELETE' });
    await loadPresets();
  }, [loadPresets]);

  const handleSave = useCallback(async (data: AgentPresetFormData) => {
    const body = {
      name: data.name,
      roleKind: data.roleKind,
      responsibility: data.responsibility,
      systemPrompt: data.systemPrompt,
      ...(data.description ? { description: data.description } : {}),
      ...(data.preferredModel ? { preferredModel: data.preferredModel } : {}),
      ...(data.mcpServers.length > 0 ? { mcpServers: data.mcpServers } : {}),
      toolPermissions: data.toolPermissions,
    };

    if (editTarget) {
      await fetch(`/api/workflow/agent-presets/${editTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch('/api/workflow/agent-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    await loadPresets();
  }, [editTarget, loadPresets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">自定义 Agent</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            创建专属 Agent 配置，在工作流和团队任务中复用
          </p>
        </div>
        <Button size="sm" onClick={handleCreate}>
          + 新建 Agent
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
      ) : presets.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center border rounded-lg border-dashed">
          <div className="mb-2 text-2xl">🤖</div>
          <div>还没有自定义 Agent</div>
          <div className="text-xs mt-1">点击「新建 Agent」创建第一个</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {presets.map(preset => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <AgentPresetEditor
        open={editorOpen}
        initial={editTarget}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
