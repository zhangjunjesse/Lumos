'use client';

// 设置 tab —— 采集用浏览器（要 EHunt 选 AdsPower）+ 危险操作（清空图库 / 清空已采集商品）。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { etsyForgeApi, type AiProviderOption } from '../api-client';
import { PromptManager } from './PromptManager';
import type { BrowserProviderConfigView, BrowserProvidersResponse } from '@/types';

const DEFAULT_BROWSER = 'embedded:default';

const PROMPT_CATS: { key: string; label: string }[] = [
  { key: 'cutout', label: '抠印花' },
  { key: 'scene', label: '场景图' },
  { key: 'model', label: '模特图' },
  { key: 'product', label: '产品图' },
  { key: 'pose', label: '抠姿势' },
];

export function SettingsTab() {
  const [browserOptions, setBrowserOptions] = useState<Array<{ id: string; label: string }>>([
    { id: DEFAULT_BROWSER, label: '内置浏览器（无 EHunt）' },
  ]);
  const [browserCtx, setBrowserCtx] = useState(DEFAULT_BROWSER);
  const [browserMsg, setBrowserMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // AI 分析服务商 / 模型（服务端筛好：text-gen 且非 local_auth）
  const [aiProviders, setAiProviders] = useState<AiProviderOption[]>([]);
  const [aiProviderId, setAiProviderId] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiLocked, setAiLocked] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [promptCat, setPromptCat] = useState('cutout');

  const loadAll = useCallback(async () => {
    try {
      const s = await etsyForgeApi.getSettings();
      setBrowserCtx(s.browser_context_id);
      setAiProviderId(s.ai_provider_id ?? '');
      setAiModel(s.ai_model ?? '');
      setAiProviders(s.ai_providers ?? []);
      setAiLocked(Boolean(s.ai_locked));
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
    setBrowserMsg(null);
    const label = browserOptions.find((o) => o.id === ctx)?.label ?? ctx;
    try {
      await etsyForgeApi.updateSettings({ browser_context_id: ctx });
      // 回读确认真的存进去了（不是乐观假成功）
      const after = await etsyForgeApi.getSettings();
      if (after.browser_context_id === ctx) {
        setBrowserMsg({ ok: true, text: `已保存：${label}` });
      } else {
        setBrowserMsg({ ok: false, text: `保存后回读不一致（存到的是 ${after.browser_context_id}），请重试或重启应用` });
        setBrowserCtx(after.browser_context_id);
      }
    } catch (err) {
      setBrowserMsg({
        ok: false,
        text: `保存失败：${err instanceof Error ? err.message : String(err)}（若是 404 多半是 dev 没重启，路由没注册）`,
      });
      void loadAll();
    }
  };

  const saveAi = async (providerId: string, model: string) => {
    setAiMsg(null);
    try {
      await etsyForgeApi.updateSettings({ ai_provider_id: providerId, ai_model: model });
      const after = await etsyForgeApi.getSettings();
      const ok = (after.ai_provider_id ?? '') === providerId && (after.ai_model ?? '') === model;
      const pName = aiProviders.find((p) => p.id === providerId)?.name ?? '全局默认';
      setAiMsg(
        ok
          ? { ok: true, text: `已保存：${providerId ? pName : '全局默认服务商'}${model ? ` · ${model}` : ''}` }
          : { ok: false, text: '保存后回读不一致，请重试' },
      );
    } catch (err) {
      setAiMsg({ ok: false, text: `保存失败：${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const onPickProvider = (pid: string) => {
    setAiProviderId(pid);
    const firstModel = aiProviders.find((p) => p.id === pid)?.models[0]?.value ?? '';
    setAiModel(firstModel);
    void saveAi(pid, firstModel);
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
          : `已清空已采集商品（删除 ${r.affected ?? 0} 个商品 + 其详情图）`,
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
        {browserMsg && (
          <p className={`mt-2 text-xs ${browserMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
            {browserMsg.text}
          </p>
        )}
        <a href="/settings" className="mt-2 block text-xs text-primary hover:underline">
          管理浏览器 / 配 AdsPower ↗
        </a>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">AI 评论分析服务商</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          图库「评论分析」用这个服务商 + 模型。<span className="text-foreground">留空=用全局默认</span>。
          {aiLocked
            ? '后台已锁定自定义服务商，只能用 Lumos 托管的（system）服务商。'
            : '建议选直连的（如阿里云通义千问），又快又稳。'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Select value={aiProviderId || '__default__'} onValueChange={(v) => onPickProvider(v === '__default__' ? '' : v)}>
            <SelectTrigger className="h-9 w-56 text-sm">
              <SelectValue placeholder="选服务商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">全局默认（不推荐）</SelectItem>
              {aiProviders.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? '（全局默认）' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {aiProviderId && (
            <Select value={aiModel} onValueChange={(v) => { setAiModel(v); void saveAi(aiProviderId, v); }}>
              <SelectTrigger className="h-9 w-48 text-sm">
                <SelectValue placeholder="选模型" />
              </SelectTrigger>
              <SelectContent>
                {(aiProviders.find((p) => p.id === aiProviderId)?.models ?? []).map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {aiMsg && (
          <p className={`mt-2 text-xs ${aiMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
            {aiMsg.text}
          </p>
        )}
        <a href="/settings" className="mt-2 block text-xs text-primary hover:underline">
          管理服务商 / 加新服务商 ↗
        </a>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">提示词管理</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          每类一段「当前生效」提示词，自动任务（抠印花 / 分析素材 / 抠姿势）都用它；可直接改，也可存多条预设切换。
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PROMPT_CATS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setPromptCat(c.key)}
              className={`rounded-md px-2.5 py-1 text-xs ${promptCat === c.key ? 'bg-foreground text-background' : 'border text-muted-foreground'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <PromptManager category={promptCat} />
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
              void danger('clear-products', '确认清空已采集商品？所有采集的商品 + 其详情图全部删除，不可恢复。')
            }
          >
            {busy === 'clear-products' ? '清空中…' : '清空已采集商品'}
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
