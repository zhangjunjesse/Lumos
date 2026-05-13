'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Save, ShieldCheck, Stethoscope } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import type { useCollectorSettings } from '../../use-collector-settings';
import { Section } from './Section';

type SaveFn = ReturnType<typeof useCollectorSettings>['save'];
type ClientSettings = NonNullable<ReturnType<typeof useCollectorSettings>['settings']>;

export function CookieSection({
  settings,
  save,
}: {
  settings: ClientSettings;
  save: SaveFn;
}): React.ReactElement {
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(settings.cookieCheckedAt);
  const [saveErr, setSaveErr] = React.useState<string | null>(null);
  const [probeMessage, setProbeMessage] = React.useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function onSave() {
    if (!draft.trim()) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await save({ cookie: draft.trim() });
      setDraft('');
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setProbeMessage(null);
    try {
      const res = await fetch(
        '/api/apps/builtin/douyin-collector/auth/test-cookie',
        { method: 'POST' },
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      setProbeMessage({
        ok: !!json.ok,
        text: json.message ?? (json.ok ? 'OK' : '探测失败'),
      });
    } catch (err) {
      setProbeMessage({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section
      title="抖音 Cookie"
      description="登录抖音后从浏览器 DevTools 复制完整 Cookie 字符串。Cookie 仅本地保存，过期 24–48 小时后请重新粘贴。"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {settings.cookieConfigured ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-3.5" />
            已配置 · {settings.cookiePreview ?? '已保存'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5" />
            尚未配置；MCP 调用会返回 not_configured。
          </span>
        )}
        {savedAt ? (
          <span className="text-muted-foreground tabular-nums">
            · 保存于 {new Date(savedAt).toLocaleString('zh-CN')}
          </span>
        ) : null}
        {settings.cookieLastOkAt ? (
          <span className="text-emerald-600 tabular-nums dark:text-emerald-400">
            · 探测 OK 于 {new Date(settings.cookieLastOkAt).toLocaleString('zh-CN')}
          </span>
        ) : null}
        {isStale(settings.cookieLastOkAt ?? savedAt) ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5" />
            Cookie 可能过期了（上次有效信号 ≥ 36 小时前）— 建议重新登录复制并测试。
          </span>
        ) : null}
      </div>
      <Textarea
        rows={3}
        placeholder="粘贴完整 Cookie；为空再保存可清除当前 Cookie"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {saveErr ? <p className="text-xs text-rose-500">{saveErr}</p> : null}
      {probeMessage ? (
        <p
          className={
            probeMessage.ok
              ? 'text-xs text-emerald-600 dark:text-emerald-400'
              : 'text-xs text-amber-600 dark:text-amber-400'
          }
        >
          {probeMessage.text}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={saving || !draft.trim()}>
          <Save className="size-3.5" />
          保存 Cookie
        </Button>
        <Button
          variant="outline"
          onClick={() => void onTest()}
          disabled={testing || !settings.cookieConfigured}
          title="向 iesdouyin 发一次基础探测，确认 Cookie 是否存活"
        >
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Stethoscope className="size-3.5" />
          )}
          测试 Cookie
        </Button>
        <Button
          variant="ghost"
          onClick={() => void save({ cookie: '' })}
          disabled={!settings.cookieConfigured}
        >
          清除
        </Button>
      </div>
    </Section>
  );
}

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;

function isStale(latestSignal: string | null | undefined): boolean {
  if (!latestSignal) return false;
  const ts = Date.parse(latestSignal);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > STALE_THRESHOLD_MS;
}
