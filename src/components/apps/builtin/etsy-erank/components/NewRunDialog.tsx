'use client';

import * as React from 'react';

import type { EntryMode } from '../etsy-erank-types';
import { useEtsyErank } from '../use-demo-state';
import { useRadarRuns } from '../use-radar-runs';
import { HealthBanner } from './HealthBanner';
import type { CascadeTarget } from '@/lib/etsy-erank/types';
import type { BrowserProvidersResponse, BrowserProviderConfigView } from '@/types';

function recentMonthOptions(): Array<{ value: string; label: string }> {
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const list: Array<{ value: string; label: string }> = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    list.push({ value, label: `${MONTH[d.getMonth()]} ${d.getFullYear()}` });
  }
  return list;
}

const CASCADE_OPTIONS: Array<{ value: CascadeTarget; label: string; hint: string }> = [
  { value: 'none', label: '不自动跑,我手动控制每一步', hint: '所有 step 都等用户点&ldquo;跑&rdquo;按钮' },
  { value: 'seed', label: '只自动跑 ②(抓种子)', hint: '② 跑完停下,后续手动' },
  { value: 'converge', label: '② → ③(默认,免费)', hint: '③ 扩词只用 Etsy 公开页 + autocomplete,不烧 eRank 配额' },
  { value: 'verify', label: '② → ③ → ④(④ 烧 eRank 配额)', hint: '④ Bulk 验真烧 maxBatches 次配额(每日 100 上限)' },
  { value: 'score', label: '② → ③ → ④ → ⑤(⑤ 烧 LLM tokens)', hint: '⑤ AI 解读用 Lumos 配置的 LLM provider' },
  { value: 'analyze', label: '② → ③ → ④ → ⑤ → ⑥(全自动)', hint: '⑥ EHunt 抓 39 A 级 × 24 listing + LLM 切入建议,约 20-30 分钟' },
];

function monthBaseLabel(): string {
  const d = new Date();
  return `OPP-雷达-${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

// 默认标签:同月已有 N 个就追加 -02/-03
function makeUniqueLabel(existingLabels: string[]): string {
  const base = monthBaseLabel();
  if (!existingLabels.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i.toString().padStart(2, '0')}`;
    if (!existingLabels.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

export function NewRunDialog({ onCreated }: { onCreated?: () => void } = {}): React.ReactElement | null {
  const { newRunOpen, dispatch } = useEtsyErank();
  const { data: existingRuns } = useRadarRuns();
  const existingLabels = React.useMemo(() => (existingRuns ?? []).map((r) => r.label), [existingRuns]);
  const defaultLabel = React.useMemo(() => makeUniqueLabel(existingLabels), [existingLabels]);
  const [label, setLabel] = React.useState(defaultLabel);
  // 默认值若变(因为列表刷新拉到新 run),自动跟进
  React.useEffect(() => {
    setLabel(defaultLabel);
  }, [defaultLabel]);
  const [mode, setMode] = React.useState<EntryMode>('with_capability');
  const [capabilitiesText, setCapabilitiesText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // 整轮参数(前置)
  const [seedTimeframe, setSeedTimeframe] = React.useState<string>('yesterday');
  const [seedLimit, setSeedLimit] = React.useState<number>(100);
  const [verifyMaxBatches, setVerifyMaxBatches] = React.useState<number>(30);
  const [cascadeTo, setCascadeTo] = React.useState<CascadeTarget>('converge');
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  // 浏览器选项 — 拉 Lumos 配置的 AdsPower profiles。空串 = 走 env 默认 profile
  const [browserContextId, setBrowserContextId] = React.useState<string>('');
  const [browserOptions, setBrowserOptions] = React.useState<BrowserProviderConfigView[] | null>(null);
  const monthOptions = React.useMemo(recentMonthOptions, []);

  React.useEffect(() => {
    if (!newRunOpen) return;
    fetch('/api/browser-providers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BrowserProvidersResponse | null) => {
        // Etsy 抓取依赖 AdsPower 登录态,只列 adspower 类型
        const adsOnly = (data?.configs ?? []).filter((c) => c.provider_type === 'adspower');
        setBrowserOptions(adsOnly);
      })
      .catch(() => setBrowserOptions([]));
  }, [newRunOpen]);

  if (!newRunOpen) return null;

  const close = () => {
    setSubmitError(null);
    dispatch({ t: 'toggle-new-run', v: false });
  };

  const submit = async () => {
    const capabilities =
      mode === 'with_capability'
        ? capabilitiesText
            .split(/[,，、\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/apps/builtin/etsy-erank/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || defaultLabel,
          entryMode: mode,
          capabilities,
          executor: 'adspower',
          config: { seedTimeframe, seedLimit, verifyMaxBatches, cascadeTo, browserContextId: browserContextId || undefined },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const { run } = (await res.json()) as { run: { id: string } };
      // 关闭弹窗,刷新列表,跳到该轮工作区
      dispatch({ t: 'toggle-new-run', v: false });
      dispatch({ t: 'open-run', v: run.id });
      onCreated?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    label.trim().length > 0 &&
    (mode === 'blank_slate' ||
      capabilitiesText.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative w-full max-w-lg rounded-2xl bg-card shadow-xl ring-1 ring-border">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">新开一轮</h2>
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            取消
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <HealthBanner />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">标签</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={defaultLabel}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              这轮的起点(决定是否跑 ① 圈猎场,本轮不可改)
            </p>

            <label
              className={`block cursor-pointer rounded-xl px-4 py-3 ring-1 transition ${
                mode === 'with_capability'
                  ? 'bg-foreground/[.04] ring-foreground'
                  : 'ring-border hover:bg-muted/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  className="mt-1"
                  checked={mode === 'with_capability'}
                  onChange={() => setMode('with_capability')}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">我有能力/方向</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    填能力 → ① AI 映射 3–5 个类目方向 → ② 按这些类目下钻
                  </p>
                  {mode === 'with_capability' && (
                    <div className="mt-2 space-y-1">
                      <textarea
                        value={capabilitiesText}
                        onChange={(e) => setCapabilitiesText(e.target.value)}
                        placeholder="如:vinyl 贴纸, POD 印花, 激光木牌(逗号/换行分隔)"
                        rows={2}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        会喂给 ① 圈猎场 AI · 只列方向,不编搜索数据
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </label>

            <label
              className={`block cursor-pointer rounded-xl px-4 py-3 ring-1 transition ${
                mode === 'blank_slate'
                  ? 'bg-foreground/[.04] ring-foreground'
                  : 'ring-border hover:bg-muted/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  className="mt-1"
                  checked={mode === 'blank_slate'}
                  onChange={() => setMode('blank_slate')}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">我完全没想法</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    跳过 ① 圈猎场 → ② 直接抄 Trend Buzz / Monthly Trends 顶部热词(全类目) →
                    让市场先开口
                  </p>
                </div>
              </div>
            </label>
          </div>

          {/* 浏览器选择 */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">用哪个浏览器(AdsPower profile)</p>
            <select
              value={browserContextId}
              onChange={(e) => setBrowserContextId(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <option value="">默认(env ADSPOWER_PROFILE_ID,通常是 k1ck97si)</option>
              {(browserOptions ?? []).map((c) => (
                <option key={c.context_id} value={c.context_id}>
                  {c.display_name || `AdsPower · ${c.profile_id || c.profile_name || c.id}`}
                </option>
              ))}
            </select>
            {browserOptions !== null && browserOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Lumos 还没配置 AdsPower profile。可在「设置 → 浏览器服务商」添加,或留默认。
              </p>
            )}
          </div>

          {/* 执行计划:跑到哪步 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              点&ldquo;开始本轮&rdquo;后自动跑到哪步
            </p>
            <select
              value={cascadeTo}
              onChange={(e) => setCascadeTo(e.target.value as CascadeTarget)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {CASCADE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {CASCADE_OPTIONS.find((o) => o.value === cascadeTo)?.hint}
            </p>
          </div>

          {/* 高级参数(可折叠) */}
          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {advancedOpen ? '▾' : '▸'} 高级参数(② 时间窗口 / 每源行数 / ④ 跑批数)
            </button>
            {advancedOpen && (
              <div className="mt-2 space-y-2 rounded-lg bg-muted/30 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-muted-foreground">② Trend Buzz 时间窗口</label>
                  <select
                    value={seedTimeframe}
                    onChange={(e) => setSeedTimeframe(e.target.value)}
                    className="flex-1 rounded border bg-background px-2 py-1"
                  >
                    <option value="yesterday">Yesterday(昨天)</option>
                    <option value="last-30-days">Last 30 Days(过去 30 天)</option>
                    <optgroup label="过去单月">
                      {monthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-muted-foreground">② 每源最多行数</label>
                  <input
                    type="number"
                    min={10} max={200} value={seedLimit}
                    onChange={(e) => setSeedLimit(Math.max(10, Math.min(200, Number(e.target.value) || 100)))}
                    className="w-24 rounded border bg-background px-2 py-1 tabular-nums"
                  />
                  <span className="text-muted-foreground">行 (10-200)</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-muted-foreground">④ Bulk 单次跑批</label>
                  <input
                    type="number"
                    min={1} max={100} value={verifyMaxBatches}
                    onChange={(e) => setVerifyMaxBatches(Math.max(1, Math.min(100, Number(e.target.value) || 30)))}
                    className="w-24 rounded border bg-background px-2 py-1 tabular-nums"
                  />
                  <span className="text-muted-foreground">批 × 20 词 (≤100 批,受 eRank 当日配额限制)</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {submitError && (
          <div className="mx-5 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
            创建失败:{submitError}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={submit}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40"
          >
            {submitting ? '创建中…' : '开始本轮'}
          </button>
        </div>
      </div>
    </div>
  );
}
