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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INTERVALS, type ScheduledWorkflow } from './ScheduleList';

const EMPTY_DSL = JSON.stringify(
  { version: 'v1', name: '', steps: [] },
  null,
  2,
);

interface ScheduleEditorProps {
  open: boolean;
  initial?: ScheduledWorkflow | null;
  onClose: () => void;
  onSave: () => void;
}

interface FormState {
  name: string;
  intervalMinutes: number;
  workingDirectory: string;
  notifyOnComplete: boolean;
  dslText: string;
}

function defaultForm(initial?: ScheduledWorkflow | null): FormState {
  return {
    name: initial?.name ?? '',
    intervalMinutes: initial?.intervalMinutes ?? 60,
    workingDirectory: initial?.workingDirectory ?? '',
    notifyOnComplete: initial?.notifyOnComplete ?? true,
    dslText: initial
      ? JSON.stringify(initial.workflowDsl, null, 2)
      : EMPTY_DSL,
  };
}

export function ScheduleEditor({ open, initial, onClose, onSave }: ScheduleEditorProps) {
  const [form, setForm] = useState<FormState>(() => defaultForm(initial));
  const [saving, setSaving] = useState(false);
  const [dslError, setDslError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(defaultForm(initial));
      setSaving(false);
      setDslError('');
    }
  }, [open, initial]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    if (key === 'dslText') setDslError('');
  }

  async function handleSave() {
    if (!form.name.trim()) return;

    let dsl: unknown;
    try {
      dsl = JSON.parse(form.dslText);
    } catch {
      setDslError('JSON 格式有误，请检查工作流 DSL');
      return;
    }

    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        intervalMinutes: form.intervalMinutes,
        workingDirectory: form.workingDirectory.trim(),
        notifyOnComplete: form.notifyOnComplete,
        workflowDsl: dsl,
      };

      const url = initial
        ? `/api/workflow/schedules/${initial.id}`
        : '/api/workflow/schedules';
      const method = initial ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑定时任务' : '新建定时任务'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>任务名称 *</Label>
              <Input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="例如：每日新闻摘要"
              />
            </div>
            <div className="space-y-1.5">
              <Label>执行频率 *</Label>
              <Select
                value={String(form.intervalMinutes)}
                onValueChange={v => set('intervalMinutes', Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map(i => (
                    <SelectItem key={i.value} value={String(i.value)}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>工作目录</Label>
            <Input
              value={form.workingDirectory}
              onChange={e => set('workingDirectory', e.target.value)}
              placeholder="留空使用默认路径"
            />
          </div>

          <div className="space-y-1.5">
            <Label>工作流 DSL (JSON) *</Label>
            <Textarea
              value={form.dslText}
              onChange={e => set('dslText', e.target.value)}
              className="font-mono text-xs min-h-[200px]"
              placeholder={EMPTY_DSL}
            />
            {dslError && (
              <p className="text-xs text-destructive">{dslError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              输入 Workflow DSL v1 JSON，可从工作流编辑器中复制
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">执行完成后通知</div>
              <div className="text-xs text-muted-foreground">通过主 Agent 发送执行结果通知</div>
            </div>
            <Switch
              checked={form.notifyOnComplete}
              onCheckedChange={v => set('notifyOnComplete', v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
