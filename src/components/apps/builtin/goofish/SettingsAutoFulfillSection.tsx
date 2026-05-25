'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useGoofishAuth } from '@/components/goofish/use-goofish-auth';

interface AutoFulfillSettings extends Record<string, unknown> {
  auto_fulfill_enabled?: boolean;
  auto_fulfill_max_price?: number;
  auto_fulfill_account_unb_whitelist?: string[] | string;
  auto_fulfill_trigger?: string[] | string;
}

export function SettingsAutoFulfillSection({
  settings,
  update,
}: {
  settings: (AutoFulfillSettings & { id: string }) | null;
  update: (patch: Partial<AutoFulfillSettings>) => void;
}): React.ReactElement {
  const { status } = useGoofishAuth();
  const accounts = status?.accounts ?? [];

  const triggers = parseArray(settings?.auto_fulfill_trigger, ['system_msg']);
  const whitelist = parseArray(settings?.auto_fulfill_account_unb_whitelist, []);

  const [confirming, setConfirming] = React.useState(false);

  const setEnabled = (next: boolean) => {
    if (next && !settings?.auto_fulfill_enabled) {
      setConfirming(true);
      return;
    }
    update({ auto_fulfill_enabled: next });
  };

  const toggleTrigger = (value: string) => {
    const next = triggers.includes(value)
      ? triggers.filter((t) => t !== value)
      : [...triggers, value];
    update({ auto_fulfill_trigger: JSON.stringify(next) });
  };

  const toggleAccount = (unb: string) => {
    const next = whitelist.includes(unb)
      ? whitelist.filter((u) => u !== unb)
      : [...whitelist, unb];
    update({ auto_fulfill_account_unb_whitelist: JSON.stringify(next) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>自动发货</span>
          <Switch
            checked={settings?.auto_fulfill_enabled === true}
            onCheckedChange={(c) => setEnabled(Boolean(c))}
          />
        </CardTitle>
        <CardDescription>
          扫描付款类系统消息，命中商品库则自动发链接 + 提取码。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" />
            风险提示
          </div>
          闲鱼没有结构化订单事件，本功能靠扫描消息识别付款。少数情况下：
          买家假说「已付款」实际未付 → 误发链接；闲鱼系统消息文案变化 → 漏判。
          建议小额商品先试运行 1-2 周再放开高客单价。
        </div>

        <div>
          <Label htmlFor="max-price">单笔最大自动发货金额（元）</Label>
          <Input
            id="max-price"
            type="number"
            min={0}
            step={1}
            value={typeof settings?.auto_fulfill_max_price === 'number'
              ? settings.auto_fulfill_max_price : 50}
            onChange={(e) => update({
              auto_fulfill_max_price: Math.max(0, Number(e.target.value) || 0),
            })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            超过此金额的订单自动转人工处理（仍写入发货记录的失败列表里方便回填）。设为 0 = 不限制。
          </p>
        </div>

        <div>
          <p className="text-sm font-medium">付款识别策略</p>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={triggers.includes('system_msg')}
                onCheckedChange={() => toggleTrigger('system_msg')}
              />
              系统消息（推荐，准）
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={triggers.includes('buyer_text')}
                onCheckedChange={() => toggleTrigger('buyer_text')}
              />
              <span>买家文本（不准，仅兜底；可能被买家假「已付款」骗）</span>
            </label>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">启用的账号（空 = 全部）</p>
          {accounts.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">还没有登录任何闲鱼账号。</p>
          ) : (
            <div className="mt-2 space-y-1.5 text-sm">
              {accounts.map((a) => (
                <label key={a.accountUnb} className="flex items-center gap-2">
                  <Checkbox
                    checked={whitelist.includes(a.accountUnb)}
                    onCheckedChange={() => toggleAccount(a.accountUnb)}
                  />
                  <span>{a.nick || a.tracknick || a.accountUnb}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {confirming ? (
        <ConfirmEnableDialog
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            update({ auto_fulfill_enabled: true });
            setConfirming(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function ConfirmEnableDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-destructive">确认开启自动发货</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          开启后只要买家会话出现「已付款」类系统消息，系统会自动发链接 + 提取码。<br />
          请确认你已经：
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
          <li>在「自动化」tab 把「自动发货扫描」开关打开</li>
          <li>在「商品库」给每个挂出去的商品关联了商品 ID</li>
          <li>商品的链接已经测试过有效（health=ok）</li>
          <li>设置了单笔金额阀值（避免误发高客单）</li>
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-muted"
          >取消</button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90"
          >我已确认，开启</button>
        </div>
      </div>
    </div>
  );
}

function parseArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : fallback;
  } catch {
    return fallback;
  }
}
