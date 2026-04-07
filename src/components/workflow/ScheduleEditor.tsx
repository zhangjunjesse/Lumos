'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { INTERVALS, type ScheduledWorkflow } from './ScheduleList';
import { WorkflowParamForm } from './WorkflowParamForm';
import type { WorkflowDSL, WorkflowParamDef } from '@/lib/workflow/types';

const EMPTY_DSL = JSON.stringify({ version: 'v2', name: '', steps: [] }, null, 2);

type RunMode = 'scheduled' | 'once';

interface WorkflowOption {
  id: string;
  name: string;
  workflowDsl: Record<string, unknown>;
}

interface ScheduleEditorProps {
  open: boolean;
  initial?: ScheduledWorkflow | null;
  /** Pre-populate with a specific workflow */
  presetWorkflowId?: string;
  presetRunMode?: RunMode;
  onClose: () => void;
  onSave: () => void;
}

interface FormState {
  name: string;
  runMode: RunMode;
  intervalMinutes: number;
  scheduleTime: string;
  scheduleDayOfWeek: number;
  workingDirectory: string;
  notifyOnComplete: boolean;
  workflowId: string;
  dslText: string;
  defaultParams: Record<string, string>;
}

function toStringParams(raw: Record<string, unknown> | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v !== undefined ? String(v) : '']));
}

/** Fill in DSL param defaults for keys not already set */
function prefillParamDefaults(
  defs: WorkflowParamDef[],
  existing: Record<string, string>,
): Record<string, string> {
  if (!defs.length) return existing;
  const merged = { ...existing };
  for (const p of defs) {
    if (!merged[p.name] && p.default !== undefined) {
      merged[p.name] = String(p.default);
    }
  }
  return merged;
}

function defaultForm(initial?: ScheduledWorkflow | null): FormState {
  return {
    name: initial?.name ?? '',
    runMode: (initial?.runMode as RunMode) ?? 'scheduled',
    intervalMinutes: initial?.intervalMinutes ?? 60,
    scheduleTime: initial?.scheduleTime ?? '09:00',
    scheduleDayOfWeek: initial?.scheduleDayOfWeek ?? 1,
    workingDirectory: initial?.workingDirectory ?? '',
    notifyOnComplete: initial?.notifyOnComplete ?? true,
    workflowId: initial?.workflowId ?? '',
    dslText: initial ? JSON.stringify(initial.workflowDsl, null, 2) : EMPTY_DSL,
    defaultParams: toStringParams(initial?.runParams),
  };
}

export function ScheduleEditor({
  open, initial, presetWorkflowId, presetRunMode, onClose, onSave,
}: ScheduleEditorProps) {
  const [form, setForm] = useState<FormState>(() => defaultForm(initial));
  const [saving, setSaving] = useState(false);
  const [dslError, setDslError] = useState('');
  const [showDsl, setShowDsl] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);

  // Load available workflows
  useEffect(() => {
    if (!open) return;
    fetch('/api/workflow/definitions')
      .then(r => r.json())
      .then((data: { workflows?: WorkflowOption[] }) => {
        setWorkflows(data.workflows ?? []);
      })
      .catch(() => {});
  }, [open]);

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;
    const base = defaultForm(initial);
    // Apply presets for quick-create from workflow editor
    if (!initial && presetWorkflowId) {
      base.workflowId = presetWorkflowId;
      if (presetRunMode) base.runMode = presetRunMode;
    }
    setForm(base);
    setSaving(false);
    setDslError('');
    setShowDsl(false);
  }, [open, initial, presetWorkflowId, presetRunMode]);

  // When workflows load and a workflowId is set, populate DSL + name + param defaults
  useEffect(() => {
    if (!form.workflowId || workflows.length === 0) return;
    const wf = workflows.find(w => w.id === form.workflowId);
    if (!wf) return;
    const dslText = JSON.stringify(wf.workflowDsl, null, 2);
    const dslParamDefs = (wf.workflowDsl as { params?: WorkflowParamDef[] }).params ?? [];
    setForm(prev => ({
      ...prev,
      dslText,
      name: prev.name || wf.name,
      defaultParams: prefillParamDefaults(dslParamDefs, prev.defaultParams),
    }));
  // Only run when workflows load or workflowId changes from preset
  }, [workflows, form.workflowId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    if (key === 'dslText') setDslError('');
  }

  function handleSelectWorkflow(wfId: string) {
    const wf = workflows.find(w => w.id === wfId);
    if (!wf) {
      set('workflowId', '');
      set('dslText', EMPTY_DSL);
      return;
    }
    const dslParamDefs = (wf.workflowDsl as { params?: WorkflowParamDef[] }).params ?? [];
    setForm(prev => ({
      ...prev,
      workflowId: wfId,
      dslText: JSON.stringify(wf.workflowDsl, null, 2),
      name: prev.name || wf.name,
      defaultParams: prefillParamDefaults(dslParamDefs, {}),
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    let dsl: unknown;
    try { dsl = JSON.parse(form.dslText); } catch {
      setDslError('JSON 格式有误，请检查工作流 DSL');
      return;
    }
    setSaving(true);
    try {
      const isDaily = form.intervalMinutes === 1440;
      const isWeekly = form.intervalMinutes === 10080;
      const body = {
        name: form.name.trim(),
        runMode: form.runMode,
        intervalMinutes: form.runMode === 'once' ? 0 : form.intervalMinutes,
        scheduleTime: (isDaily || isWeekly) ? form.scheduleTime : null,
        scheduleDayOfWeek: isWeekly ? form.scheduleDayOfWeek : null,
        workingDirectory: form.workingDirectory.trim(),
        notifyOnComplete: form.notifyOnComplete,
        workflowDsl: dsl,
        workflowId: form.workflowId || undefined,
        runParams: form.defaultParams,
      };
      const url = initial ? `/api/workflow/schedules/${initial.id}` : '/api/workflow/schedules';
      const res = await fetch(url, {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDslError((err as { error?: string }).error || '保存失败');
        return;
      }
      onSave();
      onClose();
    } finally { setSaving(false); }
  }

  const parsedDsl = (() => {
    try {
      const parsed = JSON.parse(form.dslText) as WorkflowDSL;
      return parsed?.steps?.length > 0 ? parsed : null;
    } catch { return null; }
  })();

  const dslParams: WorkflowParamDef[] = (parsedDsl as { params?: WorkflowParamDef[] } | null)?.params ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑任务' : '新建任务'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>任务名称 <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例如：每日新闻摘要" />
          </div>

          {/* Run mode toggle */}
          <div className="space-y-1.5">
            <Label>任务类型</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'once' as const, label: '一次性任务', desc: '立即执行一次' },
                { value: 'scheduled' as const, label: '定时任务', desc: '按频率重复执行' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('runMode', opt.value)}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-all ${
                    form.runMode === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/50 hover:border-border hover:bg-accent/30 text-muted-foreground'
                  }`}
                >
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Frequency picker - only for scheduled mode */}
          {form.runMode === 'scheduled' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>执行频率 <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {INTERVALS.map(i => (
                    <button
                      key={i.value}
                      type="button"
                      onClick={() => set('intervalMinutes', i.value)}
                      className={`px-2 py-1.5 rounded-md border text-xs font-medium transition-all ${
                        form.intervalMinutes === i.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/50 hover:border-border hover:bg-accent/30 text-muted-foreground'
                      }`}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weekly: day-of-week picker */}
              {form.intervalMinutes === 10080 && (
                <div className="space-y-1.5">
                  <Label>星期几</Label>
                  <div className="flex gap-1.5">
                    {(['一', '二', '三', '四', '五', '六', '日']).map((label, i) => {
                      const dow = i === 6 ? 0 : i + 1; // Mon=1..Sat=6, Sun=0
                      return (
                        <button
                          key={dow}
                          type="button"
                          onClick={() => set('scheduleDayOfWeek', dow)}
                          className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-all ${
                            form.scheduleDayOfWeek === dow
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border/50 hover:border-border hover:bg-accent/30 text-muted-foreground'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Daily / Weekly: time picker */}
              {(form.intervalMinutes === 1440 || form.intervalMinutes === 10080) && (
                <div className="space-y-1.5">
                  <Label>执行时间</Label>
                  <Input
                    type="time"
                    value={form.scheduleTime}
                    onChange={e => set('scheduleTime', e.target.value)}
                    className="w-32 h-8 text-sm"
                  />
                </div>
              )}
            </div>
          )}

          {/* Working Directory */}
          <div className="space-y-1.5">
            <Label>工作目录</Label>
            <Input value={form.workingDirectory} onChange={e => set('workingDirectory', e.target.value)} placeholder="留空使用默认路径" />
          </div>

          {/* Workflow selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>工作流 <span className="text-destructive">*</span></Label>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowDsl(v => !v)}
              >
                {showDsl ? '收起 DSL' : '编辑 DSL'}
              </button>
            </div>

            {/* Workflow dropdown */}
            {workflows.length > 0 && (
              <select
                value={form.workflowId}
                onChange={e => handleSelectWorkflow(e.target.value)}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">手动编辑 DSL</option>
                {workflows.map(wf => (
                  <option key={wf.id} value={wf.id}>{wf.name}</option>
                ))}
              </select>
            )}

            {/* Preview: step count summary */}
            {parsedDsl ? (
              <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {parsedDsl.name && <span className="font-medium text-foreground mr-2">{parsedDsl.name}</span>}
                {parsedDsl.steps.length} 个步骤
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/40 py-3 text-center text-xs text-muted-foreground">
                {workflows.length > 0 ? '请选择工作流或编辑 DSL 添加步骤' : '工作流为空，请编辑 DSL 添加步骤'}
              </div>
            )}

            {/* DSL textarea */}
            {showDsl && (
              <div className="space-y-1">
                <Textarea
                  className="font-mono text-xs min-h-[200px]"
                  value={form.dslText}
                  onChange={e => { set('dslText', e.target.value); set('workflowId', ''); set('defaultParams', {}); }}
                  spellCheck={false}
                />
                {dslError && <p className="text-xs text-destructive">{dslError}</p>}
              </div>
            )}
          </div>

          {/* Default param values — shown when DSL declares params */}
          {dslParams.length > 0 && (
            <div className="space-y-1.5">
              <div>
                <div className="text-sm font-medium mb-0.5">参数默认值</div>
                <p className="text-xs text-muted-foreground">
                  定时自动运行时使用这些值；手动运行时可以覆盖。
                  参数仅在步骤 Prompt 中包含 <code className="bg-muted px-1 rounded">{'{{'}input.参数名{'}}'}</code> 时才会注入。
                </p>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                <WorkflowParamForm
                  params={dslParams}
                  values={form.defaultParams}
                  onChange={v => set('defaultParams', v)}
                />
              </div>
            </div>
          )}

          {/* Notify toggle */}
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="text-sm font-medium">执行完成后通知</div>
              <div className="text-xs text-muted-foreground">执行完成后通过 Lumos 通知</div>
            </div>
            <Switch checked={form.notifyOnComplete} onCheckedChange={v => set('notifyOnComplete', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? '保存中...' : form.runMode === 'once' && !initial ? '创建并执行' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
