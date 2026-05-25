'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { Field, KindFields, defaultFields, parseConfigToFields } from './new-task-form';

export type RadarKind = 'monitor' | 'topic' | 'digest' | 'stats';

/** Dialog 兼容「新建」和「编辑」两种模式：editTask 存在则走编辑（PATCH），否则新建（POST）。 */
interface NewTaskDialogProps {
  open: boolean;
  kind: RadarKind | null;
  /** 编辑模式传入现有 task；新建模式 null/undefined */
  editTask?: {
    id: string;
    name?: string;
    cadence?: string;
    config_json?: string;
    im_enabled?: boolean;
    report_format?: string;
    report_style?: string;
  } | null;
  onClose: () => void;
  onCreated: () => void;
}

const KIND_TITLE: Record<RadarKind, string> = {
  monitor: '监控雷达任务',
  topic: '选题挖掘任务',
  digest: '关注摘要任务',
  stats: '数据拆解任务',
};

export function NewTaskDialog({ open, kind, editTask, onClose, onCreated }: NewTaskDialogProps): React.ReactElement | null {
  const [name, setName] = React.useState('');
  const [cadence, setCadence] = React.useState<string>('manual');
  const [imEnabled, setImEnabled] = React.useState(false);
  const [reportFormat, setReportFormat] = React.useState<string>('poster');
  const [reportStyle, setReportStyle] = React.useState<string>('business');
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !kind) return;
    if (editTask) {
      // 编辑模式：从 task 反填
      setName(editTask.name ?? '');
      setCadence(editTask.cadence ?? 'manual');
      setImEnabled(editTask.im_enabled === true);
      setReportFormat(editTask.report_format ?? 'poster');
      setReportStyle(editTask.report_style ?? 'business');
      setFields(parseConfigToFields(kind, editTask.config_json));
      setError(null);
    } else {
      // 新建模式：默认值
      setName('');
      setCadence(kind === 'monitor' ? 'hourly' : kind === 'stats' ? 'weekly' : 'daily');
      setImEnabled(false);
      setReportFormat('poster');
      setReportStyle('business');
      setFields(defaultFields(kind));
      setError(null);
    }
  }, [open, kind, editTask]);

  if (!kind) return null;
  const isEdit = !!editTask;

  const set = (k: string, v: string) => setFields((prev) => ({ ...prev, [k]: v }));
  const splitList = (v: string) => v.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);

  const save = async () => {
    if (!name.trim()) {
      setError('请填任务名');
      return;
    }
    const config = buildConfig(kind, fields);
    if ('error' in config) {
      setError(config.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 编辑模式只 PATCH 用户能改的字段（不动 last_*, enabled 状态等运行时字段）
      const body = isEdit
        ? {
            name: name.trim(),
            cadence,
            config_json: JSON.stringify(config.value),
            im_enabled: imEnabled,
            im_target_label: imEnabled ? '默认微信用户' : '',
            report_format: reportFormat,
            report_style: reportStyle,
          }
        : {
            name: name.trim(),
            kind,
            enabled: cadence !== 'manual',
            cadence,
            config_json: JSON.stringify(config.value),
            im_enabled: imEnabled,
            im_target_label: imEnabled ? '默认微信用户' : '',
            report_format: reportFormat,
            report_style: reportStyle,
            last_status: 'idle',
            last_summary: '尚未运行',
          };
      const url = isEdit
        ? `/api/apps/x-radar/data?collection=radar_tasks&id=${encodeURIComponent(editTask!.id)}`
        : '/api/apps/x-radar/data?collection=radar_tasks';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
    return;

    function buildConfig(k: RadarKind, f: Record<string, string>): { value: Record<string, unknown> } | { error: string } {
      if (k === 'monitor') {
        const keywords = splitList(f.keywords ?? '');
        const handles = splitList(f.from_handles ?? '');
        if (keywords.length === 0 && handles.length === 0) {
          return { error: 'monitor 任务必须填关键词或来自 @ 至少一项' };
        }
        return { value: {
          keywords, from_handles: handles,
          exclude_keywords: splitList(f.exclude_keywords ?? ''),
          window_hours: Number(f.window_hours) || 24,
          min_like: Number(f.min_like) || 0,
          min_retweet: Number(f.min_retweet) || 0,
          search_mode: f.search_mode === 'Top' ? 'Top' : 'Latest',
        }};
      }
      if (k === 'topic') {
        const queries = splitList(f.queries ?? '');
        if (!f.topic?.trim() && queries.length === 0) return { error: '选题任务必须填话题或关键词' };
        return { value: {
          topic: f.topic?.trim() ?? '',
          queries,
          max_fetch: Number(f.max_fetch) || 50,
          thread_extract_count: Number(f.thread_extract_count) || 20,
        }};
      }
      if (k === 'digest') {
        const handles = splitList(f.handles ?? '');
        if (handles.length === 0) return { error: '关注摘要必须填至少一个 @' };
        return { value: {
          handles,
          window_kind: f.window_kind === 'weekly' ? 'weekly' : 'daily',
          per_handle_count: Number(f.per_handle_count) || 10,
        }};
      }
      // stats
      if (!f.target?.trim()) return { error: '数据拆解必须填目标账号或话题' };
      return { value: {
        target_kind: f.target_kind === 'topic' ? 'topic' : 'handle',
        target: f.target.trim(),
        sample_days: Number(f.sample_days) || 14,
        top_threads_count: Number(f.top_threads_count) || 5,
      }};
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑 ${KIND_TITLE[kind]}` : `新建 ${KIND_TITLE[kind]}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="任务名">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="给任务起个识别名" />
          </Field>
          <KindFields kind={kind} fields={fields} set={set} />
          <Field label="执行频率">
            <Select value={cadence} onValueChange={setCadence}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">仅手动运行</SelectItem>
                <SelectItem value="hourly">每小时</SelectItem>
                <SelectItem value="every_6_hours">每 6 小时</SelectItem>
                <SelectItem value="daily">每天</SelectItem>
                <SelectItem value="weekly">每周</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="跑完推 IM">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={imEnabled} onChange={(e) => setImEnabled(e.target.checked)} />
              <span className="text-muted-foreground">
                {kind === 'monitor' ? '命中告警推到默认微信（≥2 条合并附件一次发）'
                  : '报告推到默认微信附件'}
              </span>
            </label>
          </Field>
          {imEnabled && (
            <>
              <Field label="报告格式">
                <Select value={reportFormat} onValueChange={setReportFormat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="poster">海报（推荐 · bento + 大字号 + KPI 数字）</SelectItem>
                    <SelectItem value="image">PNG 长图（旧版 · 纯 markdown 渲染）</SelectItem>
                    <SelectItem value="docx">Word 文档（适合复制编辑）</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {(reportFormat === 'poster' || reportFormat === 'image') && (
                <Field label="样式主题">
                  <Select value={reportStyle} onValueChange={setReportStyle}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="business">商务蓝（默认）</SelectItem>
                      <SelectItem value="minimal">极简白</SelectItem>
                      <SelectItem value="magazine">杂志橙</SelectItem>
                      <SelectItem value="dark">夜间黑</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </>
          )}
          {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : isEdit ? '保存修改' : '创建任务'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

