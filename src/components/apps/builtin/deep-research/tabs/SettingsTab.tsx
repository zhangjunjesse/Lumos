'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useAppCollection } from '../use-app-data';
import type { ResearchSettings } from '../deep-research-types';

interface SettingsRow extends ResearchSettings {
  id: string;
}

export function SettingsTab(): React.ReactElement {
  const { rows, create, update, refresh, loading, error } =
    useAppCollection<SettingsRow>('app_settings');
  const current = rows[0] ?? null;
  const [draft, setDraft] = React.useState<Partial<SettingsRow>>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (current) {
      setDraft(current);
    } else {
      setDraft({
        default_view: '调研任务',
        notification_channel: '关闭',
        ai_system_prompt: '',
        automation_enabled: false,
        risk_note:
          '所有写操作必须先生成草稿并由用户确认；任何阶段失败时显示真实 failure_reason，绝不用 mock 数据补齐。',
      });
    }
    // Only re-fire when the row ID changes; deps on `current` would loop
    // because every refresh returns a new object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      if (current) {
        await update(current.id, draft);
      } else {
        await create(draft);
      }
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">设置</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          配置默认视图、通知、AI 提示词、自动化开关和风险边界。设置变化会影响所有调研任务的默认行为。
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">默认值</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">默认视图</Label>
            <Select
              value={String(draft.default_view ?? '调研任务')}
              onValueChange={(v) => setDraft({ ...draft, default_view: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="调研任务">调研任务</SelectItem>
                <SelectItem value="设置">设置</SelectItem>
                <SelectItem value="自动化">自动化</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">通知方式</Label>
            <Select
              value={String(draft.notification_channel ?? '关闭')}
              onValueChange={(v) => setDraft({ ...draft, notification_channel: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="关闭">关闭</SelectItem>
                <SelectItem value="系统通知">系统通知</SelectItem>
                <SelectItem value="微信 IM">微信 IM</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 提示词</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              AI 系统提示词（用于深度调研主对话）
            </Label>
            <Textarea
              rows={10}
              value={String(draft.ai_system_prompt ?? '')}
              onChange={(e) => setDraft({ ...draft, ai_system_prompt: e.target.value })}
              placeholder="留空使用内置 SOP 提示词（澄清 → 目标 → 拆解 → 风险 → 采集 → 综合 → 报告 → 自检）"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">自动化与风险</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">启用自动化</div>
              <div className="text-xs text-muted-foreground">
                开启前必须确认运行结果和失败原因可见。
              </div>
            </div>
            <Switch
              checked={Boolean(draft.automation_enabled)}
              onCheckedChange={(v) => setDraft({ ...draft, automation_enabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">风险边界</Label>
            <Textarea
              rows={4}
              value={String(draft.risk_note ?? '')}
              onChange={(e) => setDraft({ ...draft, risk_note: e.target.value })}
              placeholder="例如：写知识库必须用户确认；任何阶段失败显示真实 failure_reason，绝不用 mock 数据。"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || loading}>
          {saving ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          保存设置
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            已保存
          </span>
        )}
      </div>
    </div>
  );
}
