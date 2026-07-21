'use client';

import * as React from 'react';

import type { CascadeTarget, TrendsPreset } from '@/lib/pinterest-radar/types';
import type { BrowserProvidersResponse, BrowserProviderConfigView } from '@/types';

const PRESET_OPTIONS: Array<{ value: TrendsPreset; label: string; hint: string }> = [
  { value: 'growing', label: 'Growing trends(本周猛涨)', hint: 'Pinterest 默认猎场 · trendsPreset=3 · 本周涨幅最高' },
  { value: 'seasonal', label: 'Seasonal trends(季节性)', hint: 'trendsPreset=4 · 按季节性得分排,适合节日 / 季节选品' },
  { value: 'monthly', label: 'Top monthly trends(月榜)', hint: 'trendsPreset=1 · 近 30 天上行' },
  { value: 'yearly', label: 'Top yearly trends(年榜)', hint: 'trendsPreset=2 · 过去 12 个月长线' },
];

const CASCADE_OPTIONS: Array<{ value: CascadeTarget; label: string; hint: string }> = [
  { value: 'none', label: '不自动跑,手动逐步', hint: '只创建轮次,所有 step 等手动' },
  { value: 'collect', label: '只跑 ②(采集 Trending)', hint: '② 跑完停下' },
  { value: 'metrics', label: '② → ③(免费)', hint: '③ 调 Pinterest /metrics 拿 90 天数据' },
  { value: 'analyze', label: '② → ③ → ④(烧 LLM)', hint: '④ AI 解读用 Lumos 默认 LLM provider' },
  { value: 'etsy_listings', label: '② → ③ → ④ → ⑤(抓 Etsy)', hint: '⑤ 每词去 etsy.com 搜 top 6 listing,~5-15 分钟' },
  { value: 'report', label: '② → ③ → ④ → ⑤ → ⑥(全自动出报告,推荐)', hint: '⑥ 输出 PDF 报告到 ~/.lumos/reports/,含 listing 图' },
];

function defaultLabel(): string {
  const d = new Date();
  return `PIN-雷达-${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

export function NewRunDialog({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (runId: string) => void;
}): React.ReactElement {
  const [label, setLabel] = React.useState(defaultLabel());
  const [country, setCountry] = React.useState('US');
  const [preset, setPreset] = React.useState<TrendsPreset>('growing');
  const [category, setCategory] = React.useState('');
  const [collectLimit, setCollectLimit] = React.useState(20);
  const [metricsDays, setMetricsDays] = React.useState(90);
  const [cascadeTo, setCascadeTo] = React.useState<CascadeTarget>('metrics');
  const [browserContextId, setBrowserContextId] = React.useState('');
  const [browserOptions, setBrowserOptions] = React.useState<BrowserProviderConfigView[] | null>(null);
  const [localChrome, setLocalChrome] = React.useState<BrowserProvidersResponse['local_chrome_context']>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/browser-providers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BrowserProvidersResponse | null) => {
        // Pinterest 抓取 trends.pinterest.com 公开页,理论上 embedded 也能跑;
        // 但实际有 cookie/区域识别,推荐用配好的 AdsPower profile。两类都列出。
        setBrowserOptions(data?.configs ?? []);
        setLocalChrome(data?.local_chrome_context ?? null);
      })
      .catch(() => setBrowserOptions([]));
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/apps/builtin/pinterest-radar/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || defaultLabel(),
          config: {
            country, preset, category: category.trim(),
            collectLimit, metricsDays, cascadeTo,
            browserContextId: browserContextId || undefined,
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const { run } = (await res.json()) as { run: { id: string } };
      onCreated(run.id);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-card shadow-xl ring-1 ring-border">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">新开一轮 Pinterest 选品</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted">取消</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">标签</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm tabular-nums"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">国家</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="US">US(美国,推荐)</option>
                <option value="GB">GB(英国)</option>
                <option value="CA">CA(加拿大)</option>
                <option value="DE">DE(德国)</option>
                <option value="FR">FR(法国)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">猎场 Preset</label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as TrendsPreset)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                {PRESET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">
            {PRESET_OPTIONS.find((o) => o.value === preset)?.hint}
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">品类筛选(可选,留空=全类目)</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="如 Home Decor / Beauty / Food"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">用哪个浏览器</label>
            <select
              value={browserContextId}
              onChange={(e) => setBrowserContextId(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <option value="">默认(env ADSPOWER_PROFILE_ID)</option>
              {localChrome && <option value={localChrome.id}>{localChrome.display_name}</option>}
              {(browserOptions ?? []).map((c) => (
                <option key={c.context_id} value={c.context_id}>
                  {c.display_name || `${c.provider_type} · ${c.profile_id || c.id}`}
                </option>
              ))}
            </select>
            {browserOptions !== null && browserOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Lumos 还没配置其他浏览器。可在「设置 → 浏览器服务商」添加。
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">点&ldquo;开始本轮&rdquo;后自动跑到哪步</p>
            <select
              value={cascadeTo}
              onChange={(e) => setCascadeTo(e.target.value as CascadeTarget)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {CASCADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {CASCADE_OPTIONS.find((o) => o.value === cascadeTo)?.hint}
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {advancedOpen ? '▾' : '▸'} 高级参数(② 采集上限 / ③ 时间窗口)
            </button>
            {advancedOpen && (
              <div className="mt-2 space-y-2 rounded-lg bg-muted/30 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-muted-foreground">② 采集上限</label>
                  <input
                    type="number"
                    min={20} max={100} value={collectLimit}
                    onChange={(e) => setCollectLimit(Math.max(20, Math.min(100, Number(e.target.value) || 20)))}
                    className="w-24 rounded border bg-background px-2 py-1 tabular-nums"
                  />
                  <span className="text-muted-foreground">个 trending 词 (20-100,Pinterest API 硬上限 100)</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-muted-foreground">③ Metrics 天数</label>
                  <input
                    type="number"
                    min={7} max={90} value={metricsDays}
                    onChange={(e) => setMetricsDays(Math.max(7, Math.min(90, Number(e.target.value) || 90)))}
                    className="w-24 rounded border bg-background px-2 py-1 tabular-nums"
                  />
                  <span className="text-muted-foreground">天 (7-90,Pinterest 上限 90)</span>
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
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting || !label.trim()}
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
