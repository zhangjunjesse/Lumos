'use client';

// 设置 tab —— 采集用浏览器（要 EHunt 选 AdsPower）+ 危险操作（清空图库 / 清空已采集商品）。

import { useCallback, useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { etsyForgeApi, type AiProviderOption } from '../api-client';
import { PromptManager } from './PromptManager';
import { ProviderPickerRow } from './ProviderPickerRow';
import { NumberSelectRow } from './NumberSelectRow';
import { DangerZoneSection } from './DangerZoneSection';
import { DirectionLibraryManager } from './DirectionLibraryManager';
import { RemixStrategyManager } from './RemixStrategyManager';
import { PROMPT_CATS } from './prompt-cats';
import type { BrowserProviderConfigView, BrowserProvidersResponse } from '@/types';

const DEFAULT_BROWSER = 'embedded:default';


export function SettingsTab() {
  const [browserOptions, setBrowserOptions] = useState<Array<{ id: string; label: string }>>([
    { id: DEFAULT_BROWSER, label: '内置浏览器（无 EHunt）' },
  ]);
  const [browserCtx, setBrowserCtx] = useState(DEFAULT_BROWSER);
  const [browserMsg, setBrowserMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'clear-library' | 'clear-products' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // AI 分析服务商 / 模型（服务端筛好：text-gen 且非 local_auth）
  const [aiProviders, setAiProviders] = useState<AiProviderOption[]>([]);
  const [aiProviderId, setAiProviderId] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiLocked, setAiLocked] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [promptCat, setPromptCat] = useState('cutout');
  const [imageConcurrency, setImageConcurrency] = useState(5);
  const [maxPose, setMaxPose] = useState(3);
  const [visionProviderId, setVisionProviderId] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [visionMsg, setVisionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const s = await etsyForgeApi.getSettings();
      setBrowserCtx(s.browser_context_id);
      setAiProviderId(s.ai_provider_id ?? '');
      setAiModel(s.ai_model ?? '');
      setAiProviders(s.ai_providers ?? []);
      setAiLocked(Boolean(s.ai_locked));
      setImageConcurrency(s.image_concurrency ?? 5);
      setMaxPose(s.max_pose ?? 3);
      setVisionProviderId(s.vision_provider_id ?? '');
      setVisionModel(s.vision_model ?? '');
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

  const saveVision = async (providerId: string, model: string) => {
    setVisionMsg(null);
    try {
      await etsyForgeApi.updateSettings({ vision_provider_id: providerId, vision_model: model });
      const pName = aiProviders.find((p) => p.id === providerId)?.name ?? '图片服务商兜底';
      setVisionMsg({ ok: true, text: `已保存：${providerId ? pName : '图片服务商兜底(gemini)'}${model ? ` · ${model}` : ''}` });
    } catch (err) {
      setVisionMsg({ ok: false, text: `保存失败：${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const onPickVision = (pid: string) => {
    setVisionProviderId(pid);
    const firstModel = aiProviders.find((p) => p.id === pid)?.models[0]?.value ?? '';
    setVisionModel(firstModel);
    void saveVision(pid, firstModel);
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

      <ProviderPickerRow
        title="AI 评论分析服务商"
        desc={
          <>
            图库「评论分析」用这个服务商 + 模型。<span className="text-foreground">留空=用全局默认</span>。
            {aiLocked ? '后台已锁定自定义服务商，只能用 Lumos 托管的（system）服务商。' : '建议选直连的（如阿里云通义千问），又快又稳。'}
          </>
        }
        providers={aiProviders}
        providerId={aiProviderId}
        model={aiModel}
        defaultLabel="全局默认（不推荐）"
        msg={aiMsg}
        footer={
          <a href="/settings" className="mt-2 block text-xs text-primary hover:underline">
            管理服务商 / 加新服务商 ↗
          </a>
        }
        onPick={onPickProvider}
        onModelChange={(v) => {
          setAiModel(v);
          void saveAi(aiProviderId, v);
        }}
      />

      <ProviderPickerRow
        title="AI 识图服务商"
        desc={
          <>
            「图片分类 / 二创拆解 / 二创质检」用这个服务商 + 模型(需支持视觉/识图,如 GPT-5.5)。
            <span className="text-foreground">留空=用图片服务商兜底(gemini-2.5-flash)</span>。换个更稳的视觉模型能减少「分类无返回内容」。
          </>
        }
        providers={aiProviders}
        providerId={visionProviderId}
        model={visionModel}
        defaultLabel="图片服务商兜底（gemini）"
        msg={visionMsg}
        onPick={onPickVision}
        onModelChange={(v) => {
          setVisionModel(v);
          void saveVision(visionProviderId, v);
        }}
      />

      <NumberSelectRow
        title="图片生成并发"
        desc="批量「抠印花 / 分析素材 / 抠姿势 / 产品合成」时同时跑几个图片生成。默认 5；太高可能被中转站限流。"
        value={imageConcurrency}
        options={[1, 2, 3, 5, 8, 10, 15, 20]}
        unit="个"
        onChange={(n) => {
          setImageConcurrency(n);
          void etsyForgeApi.updateSettings({ image_concurrency: n }).catch(() => {});
        }}
      />

      <NumberSelectRow
        title="每商品抠姿势上限"
        desc="一键出品时,抠姿势是逐张商品图出的 —— 图多的商品会出很多姿势、烧很多额度。这里限每商品最多抠几张姿势。默认 3。（场景/模特/产品图各只出 1 张,不受影响)"
        value={maxPose}
        options={[1, 2, 3, 5, 8, 10]}
        unit="张"
        onChange={(n) => {
          setMaxPose(n);
          void etsyForgeApi.updateSettings({ max_pose: n }).catch(() => {});
        }}
      />

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

      <RemixStrategyManager />

      <DirectionLibraryManager />

      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 text-sm font-medium">合规</h2>
        <p className="text-xs text-muted-foreground">
          采集到的同行商品图仅作选品研究参考，**不可直接上架售卖**（DMCA 侵权）。本应用不绕过 Etsy 反爬、不生成图、不调图片服务商。
        </p>
      </section>

      <DangerZoneSection busy={busy} msg={msg} onClear={(a, t) => void danger(a, t)} />
    </div>
  );
}

function toOption(c: BrowserProviderConfigView): { id: string; label: string } {
  const prefix = c.provider_type === 'adspower' ? 'AdsPower' : 'CDP';
  return { id: c.context_id, label: `${prefix} · ${c.display_name}` };
}
