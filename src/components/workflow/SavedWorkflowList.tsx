'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface SavedWorkflow {
  id: string;
  name: string;
  description: string;
  dslVersion: string;
  workflowDsl: Record<string, unknown>;
  createdBy: string;
  updatedAt: string;
}

interface WorkflowDslResult {
  version: string;
  name: string;
  description?: string;
  steps: Array<{ id: string; type: string; dependsOn?: string[]; input?: Record<string, unknown> }>;
}

interface SavedWorkflowListProps {
  onSelect: (workflow: { id: string; workflowDsl: WorkflowDslResult }) => void;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '刚刚';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} 小时前`;
  return `${Math.floor(ms / 86400_000)} 天前`;
}

export function SavedWorkflowList({ onSelect }: SavedWorkflowListProps) {
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/definitions');
      const data = await res.json() as { workflows?: SavedWorkflow[] };
      setWorkflows(data.workflows || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认删除此工作流？')) return;
    setDeleting(id);
    setError('');
    try {
      const res = await fetch(`/api/workflow/definitions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error || '删除失败');
        return;
      }
      setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch {
      setError('网络错误，删除失败');
    } finally { setDeleting(null); }
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-border/40 p-4">
        <div className="space-y-2 animate-pulse">
          {[1, 2].map(i => <div key={i} className="h-12 rounded bg-muted/40" />)}
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
        暂无已保存的工作流
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive px-1">{error}</p>}
    <div className="rounded-lg border border-border/40 divide-y divide-border/30 max-h-64 overflow-y-auto">
      {workflows.map(w => {
        const dsl = w.workflowDsl as { name?: string; steps?: unknown[] };
        const stepCount = Array.isArray(dsl?.steps) ? dsl.steps.length : 0;

        return (
          <div
            key={w.id}
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors group"
          >
            <button
              className="flex-1 text-left min-w-0"
              onClick={() => onSelect({ id: w.id, workflowDsl: w.workflowDsl as unknown as WorkflowDslResult })}
            >
              <div className="text-sm font-medium truncate">{w.name}</div>
              <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                <span>{stepCount} 步骤</span>
                <span>{w.dslVersion}</span>
                <span>{formatRelativeTime(w.updatedAt)}</span>
              </div>
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleDelete(w.id)}
              disabled={deleting === w.id}
            >
              {deleting === w.id ? '...' : '删除'}
            </Button>
          </div>
        );
      })}
    </div>
    </div>
  );
}
