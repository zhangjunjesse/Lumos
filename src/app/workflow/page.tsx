'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  workflowDsl: { steps?: unknown[] };
  updatedAt: string;
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

  const handleDeleted = useCallback((id: string) => {
    setWorkflows(prev => prev.filter(w => w.id !== id));
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
      const blank = { version: '2', name, steps: [] };
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
    const file = e.target.files?.[0];
    if (importInputRef.current) importInputRef.current.value = '';
    if (!file) return;
    setImportError('');
    if (file.size > 1024 * 1024) {
      setImportError('文件过大，最大支持 1MB');
      return;
    }
    try {
      const text = await file.text();
      const pkg = JSON.parse(text) as Record<string, unknown>;
      if (pkg.format !== 'lumos-workflow/v1') {
        setImportError('无效的工作流包格式：缺少 format 标识');
        return;
      }
      const res = await fetch('/api/workflow/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const data = await res.json() as {
        workflow?: { id: string };
        createdPresets?: Array<{ name: string }>;
        error?: string;
      };
      if (data.error) { setImportError(data.error); return; }
      if (data.workflow?.id) {
        router.push(`/workflow/${data.workflow.id}`);
      }
    } catch { setImportError('导入失败：文件格式不正确'); }
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-border/50 px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">工作流</h1>
          <p className="text-sm text-muted-foreground mt-0.5">用 AI 自动化你的重复任务</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => importInputRef.current?.click()}>导入</Button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button onClick={openCreate}>+ 新建工作流</Button>
        </div>
      </div>
      {importError && (
        <div className="mx-8 mt-3 text-sm px-3 py-2 rounded-lg border bg-destructive/10 text-destructive border-destructive/20">
          {importError}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* Create new card */}
            <button
              onClick={openCreate}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/10 p-5 text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground min-h-[9rem]"
            >
              <span className="text-2xl">+</span>
              <span className="text-sm font-medium">新建工作流</span>
            </button>

            {workflows.map(w => (
              <WorkflowCard
                key={w.id}
                id={w.id}
                name={w.name}
                description={w.description}
                dslVersion={w.dslVersion}
                stepCount={Array.isArray(w.workflowDsl?.steps) ? w.workflowDsl.steps.length : 0}
                updatedAt={w.updatedAt}
                onDeleted={handleDeleted}
                onRun={id => openTaskEditor(id, 'once')}
                onSchedule={id => openTaskEditor(id, 'scheduled')}
              />
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
