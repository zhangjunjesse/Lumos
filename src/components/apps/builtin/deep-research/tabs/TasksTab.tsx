'use client';

import * as React from 'react';
import { AlertCircle, ChevronRight, Compass, Loader2, Plus } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useAppCollection } from '../use-app-data';
import {
  STAGE_LABEL,
  STAGE_ORDER,
  STYLE_OPTIONS,
  type ResearchTaskRow,
} from '../deep-research-types';

interface TasksTabProps {
  tasks: ResearchTaskRow[];
  onOpen: (taskId: string) => void;
}

export function TasksTab({ tasks, onOpen }: TasksTabProps): React.ReactElement {
  const { create, refresh } = useAppCollection<ResearchTaskRow>('research_tasks');
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    title: '',
    audience: '',
    purpose: '',
    style: '行业研究',
    length_target: '5000-8000 字',
    language: 'zh-CN',
  });

  async function handleCreate() {
    if (!form.title.trim()) {
      setError('请填写主题');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await create({
        title: form.title.trim(),
        audience: form.audience.trim(),
        purpose: form.purpose.trim(),
        style: form.style,
        length_target: form.length_target,
        language: form.language,
        stage: 'clarifying',
        status: 'active',
      });
      setOpen(false);
      setForm({
        title: '',
        audience: '',
        purpose: '',
        style: '行业研究',
        length_target: '5000-8000 字',
        language: 'zh-CN',
      });
      await refresh();
      if (created?.id) onOpen(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">调研任务</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            一个任务对应一篇调研报告。新建后进入八阶段 SOP，按 clarifying →
            goal_review → planning → risk_review → collecting → synthesizing →
            outline_review → drafting → qa → delivered 推进，绝不跳阶段。
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="shrink-0">
          <Plus className="mr-1.5 size-4" />
          新建任务
        </Button>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Compass className="size-10 text-muted-foreground" strokeWidth={1.5} />
            <div className="text-sm text-muted-foreground">
              还没有调研任务。点击「新建任务」，先在需求澄清阶段把读者、用途、范围、深度、长度、语气和审美样章对齐，再进入下一阶段。
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onOpen={onOpen} />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建调研任务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Field label="主题（必填）">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="例如：2026 年中国具身智能创业公司图谱"
              />
            </Field>
            <Field label="读者">
              <Input
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                placeholder="例如：早期风险投资人 / 行业研究员"
              />
            </Field>
            <Field label="用途与决策">
              <Textarea
                rows={2}
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="读者读完后要做什么决策？"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="审美样章风格">
                <Select
                  value={form.style}
                  onValueChange={(value) => setForm({ ...form, style: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="长度目标">
                <Input
                  value={form.length_target}
                  onChange={(e) => setForm({ ...form, length_target: e.target.value })}
                  placeholder="例如：5000-8000 字"
                />
              </Field>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              新建并进入澄清
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function TaskRow({
  task,
  onOpen,
}: {
  task: ResearchTaskRow;
  onOpen: (id: string) => void;
}): React.ReactElement {
  const stageIndex = STAGE_ORDER.indexOf(task.stage ?? 'clarifying');
  const totalStages = STAGE_ORDER.length;
  const percent = stageIndex >= 0 ? Math.round((stageIndex / (totalStages - 1)) * 100) : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="group flex items-start gap-4 rounded-xl bg-card p-4 text-left ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-medium">{task.title || '（未命名）'}</h3>
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {STAGE_LABEL[task.stage ?? 'clarifying']}
          </Badge>
          {task.status === 'failed' && (
            <Badge variant="destructive" className="shrink-0 text-[11px]">
              失败
            </Badge>
          )}
          {task.status === 'paused' && (
            <Badge variant="secondary" className="shrink-0 text-[11px]">
              暂停
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.audience && <span>读者：{task.audience}</span>}
          {task.style && <span>· {task.style}</span>}
          {task.length_target && <span>· {task.length_target}</span>}
        </div>
        {task.blocking_reason && (
          <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            阻塞：{task.blocking_reason}
          </div>
        )}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-sky-500 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
