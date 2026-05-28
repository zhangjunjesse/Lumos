'use client';

// 设置 tab —— 采集用浏览器（要 EHunt 选 AdsPower）+ 危险操作（清空图库 / 清空商品列表）。

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { etsyForgeApi } from '../api-client';
import type { BrowserProviderConfigView, BrowserProvidersResponse } from '@/types';

const DEFAULT_BROWSER = 'embedded:default';

export function SettingsTab() {
  const [browserOptions, setBrowserOptions] = useState<Array<{ id: string; label: string }>>([
    { id: DEFAULT_BROWSER, label: '内置浏览器（无 EHunt）' },
  ]);
  const [browserCtx, setBrowserCtx] = useState(DEFAULT_BROWSER);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const s = await etsyForgeApi.getSettings();
      setBrowserCtx(s.browser_context_id);
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch('/api/browser-providers', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as BrowserProvidersResponse;
        const opts = [{ id: DEFAULT_BROWSER, label: '内置浏览器（无 EHunt）' }];
        for (const c of json.configs ?? []) opts.push(toOption(c));
        setBrowserOptions(opts);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveBrowser = async (ctx: string) => {
    setBrowserCtx(ctx);
    try {
      await etsyForgeApi.updateSettings({ browser_context_id: ctx });
    } catch {
      /* ignore */
    }
  };

  const danger = async (action: 'clear-library' | 'clear-products', confirmText: string) => {
    if (!confirm(confirmText)) return;
    setBusy(action);
    setMsg(null);
    try {
      const r = await etsyForgeApi.danger(action);
      setMsg(
        action === 'clear-library'
          ? `已清空图库（删除 ${r.affected ?? 0} 张详情图）`
          : `已清空商品列表（删除 ${r.affected ?? 0} 个商品 + 其详情图）`,
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">采集浏览器</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          采集走这个浏览器上下文抓 Etsy。<span className="text-foreground">要 EHunt 指标（销量/收藏/上架日期）必须选 AdsPower</span>，且该 profile 装了 EHunt 扩展、登录了 Etsy。内置浏览器只能拿主图，无 EHunt。
        </p>
        <Select value={browserCtx} onValueChange={(v) => void saveBrowser(v)}>
          <SelectTrigger className="h-9 w-full max-w-sm text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {browserOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <a href="/settings" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
          管理浏览器 / 配 AdsPower <ExternalLink className="size-3" />
        </a>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">合规</h2>
        <p className="text-xs text-muted-foreground">
          采集到的同行商品图仅作选品研究参考，**不可直接上架售卖**（DMCA 侵权）。本应用不绕过 Etsy 反爬、不生成图、不调图片服务商。
        </p>
      </section>

      <section className="rounded-lg border border-destructive/30 bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-destructive">危险操作</h2>
        {msg && <p className="mb-3 rounded bg-muted p-2 text-xs text-muted-foreground">{msg}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void danger('clear-library', '确认清空图库？所有采集的详情图记录删除，不可恢复。')}
          >
            {busy === 'clear-library' ? '清空中…' : '清空图库'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void danger('clear-products', '确认清空商品列表？所有采集的商品 + 其详情图全部删除，不可恢复。')
            }
          >
            {busy === 'clear-products' ? '清空中…' : '清空商品列表'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function toOption(c: BrowserProviderConfigView): { id: string; label: string } {
  const prefix = c.provider_type === 'adspower' ? 'AdsPower' : 'CDP';
  return { id: c.context_id, label: `${prefix} · ${c.display_name}` };
}
