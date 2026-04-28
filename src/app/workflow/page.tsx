'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';
import { ScheduleEditor } from '@/components/workflow/ScheduleEditor';

interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  dslVersion: string;
  groupName: string;
  workflowDsl: { nodes?: unknown[] };
  updatedAt: string;
}

interface WorkflowImportPackage {
  format: 'lumos-workflow/v1';
  workflow: unknown;
  agents?: Record<string, unknown>;
}

interface WorkflowImportBundle {
  format: 'lumos-workflow-bundle/v1';
  exportedAt?: string;
  workflows: Array<{
    workflow: unknown;
    agents?: Record<string, unknown>;
  }>;
}

function isWorkflowImportPackage(value: unknown): value is WorkflowImportPackage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.format === 'lumos-workflow/v1' && Boolean(record.workflow);
}

function isWorkflowImportBundle(value: unknown): value is WorkflowImportBundle {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.format === 'lumos-workflow-bundle/v1' && Array.isArray(record.workflows);
}

function buildImportPayload(packages: Array<WorkflowImportPackage | WorkflowImportBundle>) {
  if (packages.length === 1) {
    return packages[0];
  }

  return {
    format: 'lumos-workflow-bundle/v1',
    exportedAt: new Date().toISOString(),
    workflows: packages.flatMap((pkg) => {
      if (isWorkflowImportBundle(pkg)) {
        return pkg.workflows;
      }
      return [{ workflow: pkg.workflow, agents: pkg.agents ?? {} }];
    }),
  };
}

export default function WorkflowPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [taskWorkflowId, setTaskWorkflowId] = useState('');
  const [taskRunMode, setTaskRunMode] = useState<'once' | 'scheduled'>('once');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const openTaskEditor = useCallback((id: string, mode: 'once' | 'scheduled') => {
    setTaskWorkflowId(id);
    setTaskRunMode(mode);
    setTaskEditorOpen(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/definitions');
      const data = await res.json() as { workflows?: WorkflowItem[] };
      setWorkflows(data.workflows ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setSelectedIds(prev => {
      const workflowIds = new Set(workflows.map(w => w.id));
      const next = new Set(Array.from(prev).filter(id => workflowIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [workflows]);

  const handleDeleted = useCallback((id: string) => {
    setWorkflows(prev => prev.filter(w => w.id !== id));
  }, []);

  const handleGroupChange = useCallback(async (id: string, groupName: string) => {
    setWorkflows(prev => prev.map(w => w.id === id ? { ...w, groupName } : w));
    try {
      await fetch(`/api/workflow/definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName }),
      });
    } catch { /* ignore, optimistic update already applied */ }
  }, []);

  const openCreate = useCallback(() => {
    setNewName('');
    setCreateError('');
    setCreateOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const handleCreate = useCallback(async () => {
    const name = newName.trim() || '新工作流';
    setCreating(true);
    try {
      const blank = { version: 'v3', name, nodes: [], edges: [] };
      const res = await fetch('/api/workflow/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: '', workflowDsl: blank, createdBy: 'manual' }),
      });
      const data = await res.json() as { workflow?: { id: string } };
      if (data.workflow?.id) {
        setCreateOpen(false);
        router.push(`/workflow/${data.workflow.id}`);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败，请重试');
    } finally { setCreating(false); }
  }, [newName, router]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (importInputRef.current) importInputRef.current.value = '';
    if (files.length === 0) return;
    setImportError('');
    setImportNotice('');
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 10 * 1024 * 1024) {
      setImportError('文件过大，单次最大支持 10MB');
      return;
    }
    try {
      const packages = await Promise.all(
        files.map(async (file) => JSON.parse(await file.text()) as unknown),
      );
      const validPackages = packages.filter(
        (pkg): pkg is WorkflowImportPackage | WorkflowImportBundle => (
          isWorkflowImportPackage(pkg) || isWorkflowImportBundle(pkg)
        ),
      );
      if (validPackages.length !== packages.length) {
        setImportError('无效的工作流包格式：缺少 format 标识');
        return;
      }
      const payload = buildImportPayload(validPackages);
      const res = await fetch('/api/workflow/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as {
        workflow?: { id: string };
        workflows?: Array<{ id: string; name?: string }>;
        count?: number;
        createdPresets?: Array<{ name: string }>;
        error?: string;
      };
      if (data.error) { setImportError(data.error); return; }
      const importedCount = data.count ?? data.workflows?.length ?? (data.workflow ? 1 : 0);
      if (importedCount > 1) {
        setImportNotice(`已导入 ${importedCount} 个工作流`);
        await load();
      } else if (data.workflow?.id) {
        router.push(`/workflow/${data.workflow.id}`);
      } else {
        await load();
      }
    } catch { setImportError('导入失败：文件格式不正确'); }
  }, [load, router]);

  const handleSelectWorkflow = useCallback((id: string, selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === workflows.length) {
        return new Set();
      }
      return new Set(workflows.map(w => w.id));
    });
  }, [workflows]);

  const downloadJson = useCallback((data: unknown, fileName: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleBulkExport = useCallback(async (mode: 'selected' | 'all') => {
    const ids = mode === 'selected' ? Array.from(selectedIds) : workflows.map(w => w.id);
    if (ids.length === 0) {
      setImportError('请选择要导出的工作流');
      return;
    }

    setExporting(true);
    setImportError('');
    setImportNotice('');
    try {
      const res = await fetch('/api/workflow/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'all' ? { all: true } : { ids }),
      });
      const data = await res.json() as { error?: string; count?: number };
      if (!res.ok || data.error) {
        setImportError(data.error || '导出失败');
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const count = data.count ?? ids.length;
      downloadJson(data, `lumos-workflows-${date}-${count}.json`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, [downloadJson, selectedIds, workflows]);

  // Compute group metadata
  const existingGroups = [...new Set(workflows.map(w => w.groupName).filter(Boolean))].sort();
  const ungrouped = workflows.filter(w => !w.groupName);
  const grouped = existingGroups.map(g => ({
    name: g,
    items: workflows.filter(w => w.groupName === g),
  }));

  const cardProps = (w: WorkflowItem) => ({
    id: w.id,
    name: w.name,
    // Fallback to DSL-level description so historical workflows (saved before
    // the editor mirrored description into the workflows column) still render.
    description: w.description
      || (w.workflowDsl as { description?: string } | undefined)?.description
      || '',
    dslVersion: w.dslVersion,
    stepCount: Array.isArray(w.workflowDsl?.nodes) ? w.workflowDsl.nodes.length : 0,
    updatedAt: w.updatedAt,
    groupName: w.groupName,
    existingGroups,
    onDeleted: handleDeleted,
    onGroupChange: handleGroupChange,
    onRun: (id: string) => openTaskEditor(id, 'once'),
    onSchedule: (id: string) => openTaskEditor(id, 'scheduled'),
    selected: selectedIds.has(w.id),
    onSelectedChange: handleSelectWorkflow,
  });

  const gridClass = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex flex-col gap-4 border-b border-border/50 px-8 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">工作流</h1>
          <p className="text-sm text-muted-foreground mt-0.5">用 AI 自动化你的重复任务</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workflows.length > 0 && (
            <>
              <Button variant="outline" onClick={handleSelectAll}>
                {selectedIds.size === workflows.length ? '取消选择' : '全选'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleBulkExport('selected')}
                disabled={selectedIds.size === 0 || exporting}
              >
                <Download className="h-4 w-4" />
                导出已选{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleBulkExport('all')}
                disabled={exporting}
              >
                <Download className="h-4 w-4" />
                导出全部
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => importInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            导入
          </Button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" multiple onChange={handleImport} />
          <Button onClick={openCreate}>+ 新建工作流</Button>
        </div>
      </div>
      {importError && (
        <div className="mx-8 mt-3 text-sm px-3 py-2 rounded-lg border bg-destructive/10 text-destructive border-destructive/20">
          {importError}
        </div>
      )}
      {importNotice && (
        <div className="mx-8 mt-3 text-sm px-3 py-2 rounded-lg border bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
          {importNotice}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className={gridClass}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-36 rounded-xl border border-border/40 bg-muted/20 animate-pulse" />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 py-24 text-center">
            <div className="text-5xl">⚡</div>
            <div>
              <p className="text-base font-medium">还没有工作流</p>
              <p className="text-sm text-muted-foreground mt-1">用自然语言描述你想自动化的任务，AI 帮你生成</p>
            </div>
            <Button size="lg" onClick={openCreate}>新建工作流</Button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Ungrouped (includes the + new card) */}
            <div className={gridClass}>
              <button
                onClick={openCreate}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/10 p-5 text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground min-h-[9rem]"
              >
                <span className="text-2xl">+</span>
                <span className="text-sm font-medium">新建工作流</span>
              </button>
              {ungrouped.map(w => (
                <WorkflowCard key={w.id} {...cardProps(w)} />
              ))}
            </div>

            {/* Named groups */}
            {grouped.map(group => (
              <div key={group.name}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm font-medium text-foreground/70">{group.name}</span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[11px] text-muted-foreground">{group.items.length} 个</span>
                </div>
                <div className={gridClass}>
                  {group.items.map(w => (
                    <WorkflowCard key={w.id} {...cardProps(w)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建工作流</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Input
              ref={nameInputRef}
              placeholder="工作流名称"
              value={newName}
              onChange={e => { setNewName(e.target.value); setCreateError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
            />
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" asChild>
              <Link href="/workflow/new">AI 辅助创建</Link>
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScheduleEditor
        open={taskEditorOpen}
        presetWorkflowId={taskWorkflowId}
        presetRunMode={taskRunMode}
        onClose={() => setTaskEditorOpen(false)}
        onSave={() => setTaskEditorOpen(false)}
      />
    </div>
  );
}
