'use client';

import * as React from 'react';
import { Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useAppSettings } from './use-goofish-app-data';

interface GoofishAppSettings extends Record<string, unknown> {
  ai_system_prompt?: string;
  risk_note?: string;
  per_buyer_throttle_minutes?: number;
  global_throttle_per_minute?: number;
  default_reminder_channels?: string;
  auto_reply_global_enabled?: boolean;
}

const DEFAULT_AI_PROMPT =
  '你是闲鱼卖家的 AI 助手。回复风格：\n- 简短克制，不超过 2 句\n- 不主动承诺保修、退换或额外服务\n- 议价范围 5%-10% 内可接，超出请人工\n- 物流问题先确认订单号再回复\n- 售后投诉转人工，不擅自处理';

const ALL_CHANNELS = [
  { value: 'in_app', label: '应用内', enabled: true },
  { value: 'wechat', label: '微信 IM（需桥连通）', enabled: true },
  { value: 'desktop', label: '桌面通知（待 NotificationCenter 接入）', enabled: false },
];

export function SettingsTab(): React.ReactElement {
  const { settings, loading, saving, error, update } = useAppSettings<GoofishAppSettings>();

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <SaveStatus saving={saving} error={error} />
      <SectionAiPrompt settings={settings} update={update} />
      <SectionRiskNote settings={settings} update={update} />
      <SectionThrottle settings={settings} update={update} />
      <SectionDefaultChannels settings={settings} update={update} />
      <SectionStatusInfo />
    </div>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">加载设置…</p>
    </div>
  );
}

function SaveStatus({
  saving,
  error,
}: {
  saving: boolean;
  error: string | null;
}): React.ReactElement | null {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>保存失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (saving) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Save className="size-3.5" /> 自动保存中…
      </div>
    );
  }
  return null;
}

interface SectionProps {
  settings: (GoofishAppSettings & { id: string }) | null;
  update: (patch: Partial<GoofishAppSettings>) => void;
}

function SectionAiPrompt({ settings, update }: SectionProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 提示词</CardTitle>
        <CardDescription>
          影响草稿生成的语气、边界、议价范围。修改后下一条草稿生效，已生成的草稿不会重写。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          value={settings?.ai_system_prompt ?? ''}
          placeholder={DEFAULT_AI_PROMPT}
          rows={9}
          onChange={(e) => update({ ai_system_prompt: e.target.value })}
        />
      </CardContent>
    </Card>
  );
}

function SectionRiskNote({ settings, update }: SectionProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>风险边界</CardTitle>
        <CardDescription>
          列出本应用不允许的操作或必须人工处理的场景。会作为 AI 上下文传入草稿生成器。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          value={settings?.risk_note ?? ''}
          placeholder={'例如：\n- 不承诺退款\n- 不擅自改价\n- 投诉/差评一律转人工'}
          rows={5}
          onChange={(e) => update({ risk_note: e.target.value })}
        />
      </CardContent>
    </Card>
  );
}

function SectionThrottle({ settings, update }: SectionProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>自动回复频控</CardTitle>
        <CardDescription>
          白名单自动回复扫描器读这两个阈值。命中白名单后超过阈值的会降级为草稿等确认。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="per-buyer">每个买家·分钟</Label>
          <Input
            id="per-buyer"
            type="number"
            min={1}
            max={60}
            value={settings?.per_buyer_throttle_minutes ?? 5}
            onChange={(e) =>
              update({ per_buyer_throttle_minutes: Number(e.target.value) || 1 })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            同一买家窗口内最多自动回复 1 条，默认 5 分钟。
          </p>
        </div>
        <div>
          <Label htmlFor="global">全账号·1 分钟上限</Label>
          <Input
            id="global"
            type="number"
            min={1}
            max={60}
            value={settings?.global_throttle_per_minute ?? 10}
            onChange={(e) =>
              update({ global_throttle_per_minute: Number(e.target.value) || 1 })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            全部账号 1 分钟内自动回复总数上限，默认 10 条。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function parseChannels(json?: string): string[] {
  if (!json) return ['in_app'];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : ['in_app'];
  } catch {
    return ['in_app'];
  }
}

function SectionDefaultChannels({ settings, update }: SectionProps): React.ReactElement {
  const channels = parseChannels(settings?.default_reminder_channels);
  const toggle = (value: string) => {
    const next = channels.includes(value)
      ? channels.filter((c) => c !== value)
      : [...channels, value];
    update({ default_reminder_channels: JSON.stringify(next) });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>新建提醒规则的默认通道</CardTitle>
        <CardDescription>
          新增提醒规则时预选哪些通道。已有规则不受影响。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ALL_CHANNELS.map((c) => (
          <label
            key={c.value}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              checked={channels.includes(c.value)}
              onCheckedChange={() => toggle(c.value)}
              disabled={!c.enabled}
            />
            <span className={c.enabled ? '' : 'text-muted-foreground'}>{c.label}</span>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

function SectionStatusInfo(): React.ReactElement {
  const [info, setInfo] = React.useState<{
    version: string | null;
    accountCount: number;
    loggedInCount: number;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/apps/builtin/goofish/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setInfo({
          version: j?.install?.version ?? null,
          accountCount: j?.auth?.accountCount ?? 0,
          loggedInCount: j?.auth?.loggedInCount ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>应用信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <Row label="应用版本" value={info?.version ?? '加载中…'} />
        <Row label="已配置账号" value={`${info?.accountCount ?? 0} 个`} />
        <Row label="登录中账号" value={`${info?.loggedInCount ?? 0} 个`} />
        <Row label="数据目录" value="~/.lumos/apps/goofish-assistant/" />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
