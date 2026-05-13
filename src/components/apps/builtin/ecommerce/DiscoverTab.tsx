'use client';

import * as React from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Calendar,
  Check,
  Compass,
  DollarSign,
  Edit3,
  Eye,
  ExternalLink,
  GitCompare,
  ImageIcon,
  Images,
  Languages,
  Layers3,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Search,
  Sparkles,
  Table2,
  Target,
  Trash2,
  X,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { openExternalUrl } from '@/lib/open-external';

import { BrowserFetchSettingsCard } from './BrowserFetchSettingsCard';

import type { DiscoverCandidate, DiscoverReferenceUrl } from './types';

interface CompareResult {
  recommended_id: string;
  summary: string;
  notes: Array<{ id: string; verdict: string; reason: string }>;
  next_actions: string[];
  weighted: Array<{ id: string; weightedScore: number }>;
}

interface SourceEntry {
  kind: string;
  source?: string;
  url?: string;
  hot_selling_only?: boolean;
  sample_count?: number;
  samples?: SourceSample[];
  details?: SourceDetail[];
  detail_warnings?: string[];
  reason?: string;
  label?: string;
  weights?: Record<string, number>;
  rule?: string;
  fetched_at?: string;
  fetched_via?: string | null;
}

interface SourceSample {
  title: string;
  product_id?: string | null;
  price?: string | null;
  rating?: string | null;
  reviews?: string | null;
  sales?: string | null;
  brand?: string | null;
  category?: string | null;
  url?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  image_urls?: string[];
  keyword_tags?: string[];
  badges?: string[];
  sponsored?: boolean | null;
  heat_score?: number | null;
  heat_level?: string | null;
  heat_confidence?: string | null;
  heat_reasons?: string[];
}

interface SourceDetail extends SourceSample {
  rank?: number;
  brand?: string | null;
  category?: string | null;
  availability?: string | null;
  bullet_points?: string[];
  description?: string | null;
  gallery_image_urls?: string[];
  review_snippets?: string[];
  fetched_at?: string;
  fetched_via?: string | null;
}

interface ResearchSample {
  id: string;
  platform: string;
  title: string;
  price: string | null;
  rating: string | null;
  reviews: string | null;
  sales: string | null;
  url: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  keywordTags: string[];
  badges: string[];
  productId: string | null;
  sponsored: boolean;
  rank: number | null;
  brand: string | null;
  category: string | null;
  availability: string | null;
  description: string | null;
  reviewSnippets: string[];
  fetchedAt: string | null;
  fetchedVia: string | null;
  detailStatus: '搜索页样品' | '详情页已打开';
  sourceKeyword: string;
  bulletPoints: string[];
  heatScore: number | null;
  heatLevel: string | null;
  heatConfidence: string | null;
  heatReasons: string[];
}

interface ResearchRun {
  id: string;
  keyword: string;
  market: string;
  priceBand: string | null;
  strategy: string | null;
  platforms: string[];
  hotSellingOnly: boolean;
  status: '研究中' | '已完成' | '失败';
  candidates: DiscoverCandidate[];
  samples: ResearchSample[];
  sampleCount: number;
  detailCount: number;
  failureReason: string | null;
  failedSources: Array<{ source: string; reason: string }>;
  detailWarnings: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

interface InsightItem {
  title: string;
  value: string;
  detail: string;
  tone: 'green' | 'amber' | 'blue' | 'neutral';
}

interface DecisionGrade {
  grade: 'A' | 'B' | 'C';
  label: string;
  summary: string;
  nextAction: string;
  className: string;
}

const DEFAULT_MARKETS = ['美国 US', '英国 UK', '德国 DE', '日本 JP', '东南亚 SEA'] as const;

const PLATFORM_OPTIONS = [
  { id: 'amazon', label: 'Amazon', fetchable: true },
  { id: 'tiktok-shop', label: 'TikTok Shop', fetchable: true },
  { id: 'etsy', label: 'Etsy', fetchable: true },
  { id: 'walmart', label: 'Walmart', fetchable: true },
  { id: 'shopify-dtc', label: 'Shopify 独立站', fetchable: false },
  { id: 'shopee', label: 'Shopee', fetchable: false },
  { id: 'lazada', label: 'Lazada', fetchable: false },
] as const;

const STRATEGY_OPTIONS = [
  { id: 'blue-ocean', label: '蓝海' },
  { id: 'follow-trend', label: '跟风' },
  { id: 'seasonal', label: '季节性' },
  { id: 'big-sale', label: '大促' },
  { id: 'evergreen', label: '常青款' },
] as const;

const KEYWORD_TRANSLATION_LANGUAGES = [
  { value: 'English', label: '英文' },
  { value: 'Japanese', label: '日文' },
  { value: 'German', label: '德文' },
  { value: 'French', label: '法文' },
  { value: 'Spanish', label: '西文' },
  { value: 'Korean', label: '韩文' },
  { value: 'custom', label: '自定义' },
] as const;

interface DiscoverTabProps {
  candidates: DiscoverCandidate[];
  loading: boolean;
  onChanged: () => void;
  onSwitchToStudio: () => void;
}

export function DiscoverTab({
  candidates,
  loading,
  onChanged,
  onSwitchToStudio,
}: DiscoverTabProps): React.ReactElement {
  const [keyword, setKeyword] = React.useState('');
  const [market, setMarket] = React.useState<string>(DEFAULT_MARKETS[0]);
  const [priceBand, setPriceBand] = React.useState('');
  const [platforms, setPlatforms] = React.useState<string[]>(['amazon']);
  const [strategy, setStrategy] = React.useState<string>(STRATEGY_OPTIONS[0].id);
  const [hotSellingOnly, setHotSellingOnly] = React.useState(false);
  const [sampleCount, setSampleCount] = React.useState(12);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [translationLanguage, setTranslationLanguage] = React.useState<string>('English');
  const [customTranslationLanguage, setCustomTranslationLanguage] = React.useState('');
  const [translatingKeyword, setTranslatingKeyword] = React.useState(false);
  const [translationError, setTranslationError] = React.useState<string | null>(null);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [comparing, setComparing] = React.useState(false);
  const [compareResult, setCompareResult] = React.useState<CompareResult | null>(null);
  const [compareError, setCompareError] = React.useState<string | null>(null);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [batchPromoting, setBatchPromoting] = React.useState(false);
  const [batchProgress, setBatchProgress] = React.useState<{ done: number; total: number } | null>(
    null,
  );
  const [batchSummary, setBatchSummary] = React.useState<string | null>(null);
  const [detailResearchId, setDetailResearchId] = React.useState<string | null>(null);
  const [optimisticCandidates, setOptimisticCandidates] = React.useState<DiscoverCandidate[]>([]);

  const effectiveCandidates = React.useMemo(() => {
    if (optimisticCandidates.length === 0) return candidates;
    const realResearchIds = new Set(candidates.map((candidate) => candidate.research_id));
    return [
      ...optimisticCandidates.filter((candidate) => !realResearchIds.has(candidate.research_id)),
      ...candidates,
    ];
  }, [candidates, optimisticCandidates]);
  const researchRuns = React.useMemo(() => buildResearchRuns(effectiveCandidates), [effectiveCandidates]);
  const detailResearch = React.useMemo(
    () => researchRuns.find((run) => run.id === detailResearchId) ?? null,
    [researchRuns, detailResearchId],
  );
  const detailMode = detailResearchId !== null;

  React.useEffect(() => {
    clearSelection();
  }, [detailResearchId]);

  React.useEffect(() => {
    if (optimisticCandidates.length === 0) return;
    const realResearchIds = new Set(candidates.map((candidate) => candidate.research_id));
    setOptimisticCandidates((prev) =>
      prev.filter((candidate) => !realResearchIds.has(candidate.research_id)),
    );
  }, [candidates, optimisticCandidates.length]);

  React.useEffect(() => {
    if (!researchRuns.some((run) => run.status === '研究中')) return;
    const timer = window.setInterval(() => {
      void onChanged();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [researchRuns, onChanged]);

  const toggleSelect = (id: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const clearSelection = () => setSelectedIds(new Set());

  const runCompare = async () => {
    setComparing(true);
    setCompareError(null);
    setCompareResult(null);
    setCompareOpen(true);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/discover/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_ids: Array.from(selectedIds) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCompareError((json as { error?: string }).error ?? `对比失败 (${res.status})`);
        return;
      }
      setCompareResult(json as CompareResult);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
    } finally {
      setComparing(false);
    }
  };

  const candidatesById = React.useMemo(
    () => Object.fromEntries(effectiveCandidates.map((c) => [c.id, c])),
    [effectiveCandidates],
  );

  const runBatchPromote = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > 6) {
      setBatchSummary('单次最多 6 个候选。');
      return;
    }
    // Filter out already-promoted candidates client-side; server would reject too.
    const eligible = ids.filter((id) => candidatesById[id]?.status !== 'promoted');
    if (eligible.length === 0) {
      setBatchSummary('选中的候选已全部 promoted。');
      return;
    }
    setBatchPromoting(true);
    setBatchProgress({ done: 0, total: eligible.length });
    setBatchSummary(null);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/discover/promote/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_ids: eligible }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        succeeded?: number;
        failed?: number;
        outcomes?: Array<{ ok: boolean; error?: string; concept_image_failed?: string | null }>;
        error?: string;
      };
      if (!res.ok) {
        setBatchSummary(json.error ?? `批量转入失败 (${res.status})`);
        return;
      }
      const failed = json.failed ?? 0;
      const conceptFailed = (json.outcomes ?? []).filter((o) => o.concept_image_failed).length;
      setBatchSummary(
        `${json.succeeded}/${eligible.length} 已转入工坊。${
          failed > 0 ? `${failed} 失败；` : ''
        }${conceptFailed > 0 ? `${conceptFailed} 概念图未生成（去工坊补主图）。` : ''}`,
      );
      clearSelection();
      onChanged();
    } catch (err) {
      setBatchSummary(err instanceof Error ? err.message : String(err));
    } finally {
      setBatchPromoting(false);
      setBatchProgress(null);
    }
  };

  const togglePlatform = (id: string) => {
    const option = PLATFORM_OPTIONS.find((p) => p.id === id);
    if (!option?.fetchable) return;
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const runKeywordTranslation = async () => {
    const sourceKeyword = keyword.trim();
    const targetLanguage =
      translationLanguage === 'custom'
        ? customTranslationLanguage.trim()
        : translationLanguage;
    setTranslationError(null);
    if (!sourceKeyword) {
      setTranslationError('请先输入关键词。');
      return;
    }
    if (!targetLanguage) {
      setTranslationError('请先填写目标语言。');
      return;
    }
    setTranslatingKeyword(true);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/discover/translate-keyword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: sourceKeyword,
          target_language: targetLanguage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        translated_keyword?: string;
        error?: string;
      };
      if (!res.ok) {
        setTranslationError(json.error ?? `翻译失败 (${res.status})`);
        return;
      }
      const translated = json.translated_keyword?.trim();
      if (!translated) {
        setTranslationError('翻译结果为空。');
        return;
      }
      setKeyword(translated);
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranslatingKeyword(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!keyword.trim()) {
      setError('关键词不能为空。');
      return;
    }
    if (platforms.length === 0) {
      setError('至少选 1 个目标平台。');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keyword.trim(),
          market: market.trim(),
          price_band: priceBand.trim() || undefined,
          platform_focus: platforms,
          strategy,
          sample_count: sampleCount,
          hot_selling_only: hotSellingOnly,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (json.code === 'no-live-data') {
          setError(
            json.error ??
              '无法从任何目标平台获取真实样品数据，已拒绝退回模型估算（避免生成虚构产品）。请检查网络 / VPN 后重试。',
          );
          return;
        }
        setError(json.error ?? `请求失败 (${res.status})`);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        research_id?: string;
        candidates?: DiscoverCandidate[];
      };
      if (json.research_id && json.candidates?.length) {
        const pendingCandidates = json.candidates;
        setOptimisticCandidates((prev) => [
          ...prev.filter((candidate) => candidate.research_id !== json.research_id),
          ...pendingCandidates,
        ]);
      }
      void onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!detailMode ? (
        <>
          <BrowserFetchSettingsCard />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Compass className="size-4" /> 发起一次选品研究
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={handleSubmit}>
                <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
                  <div>
                    <Label htmlFor="keyword" className="text-xs">
                      关键词 <span className="text-muted-foreground">（如「便携咖啡杯」）</span>
                    </Label>
                    <Input
                      id="keyword"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="便携咖啡杯"
                      disabled={submitting}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={translationLanguage}
                        onChange={(e) => {
                          setTranslationLanguage(e.target.value);
                          setTranslationError(null);
                        }}
                        disabled={submitting || translatingKeyword}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        aria-label="关键词翻译目标语言"
                      >
                        {KEYWORD_TRANSLATION_LANGUAGES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      {translationLanguage === 'custom' ? (
                        <Input
                          value={customTranslationLanguage}
                          onChange={(e) => {
                            setCustomTranslationLanguage(e.target.value);
                            setTranslationError(null);
                          }}
                          placeholder="目标语言，如 Italian"
                          disabled={submitting || translatingKeyword}
                          className="h-8 w-40 text-xs"
                        />
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={runKeywordTranslation}
                        disabled={submitting || translatingKeyword || !keyword.trim()}
                      >
                        {translatingKeyword ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Languages className="size-3" />
                        )}
                        翻译关键词
                      </Button>
                    </div>
                    {translationError ? (
                      <p className="mt-1 text-[11px] text-destructive">{translationError}</p>
                    ) : null}
                  </div>
                  <div>
                    <Label htmlFor="market" className="text-xs">
                      目标市场
                    </Label>
                    <select
                      id="market"
                      value={market}
                      onChange={(e) => setMarket(e.target.value)}
                      disabled={submitting}
                      className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      {DEFAULT_MARKETS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="priceBand" className="text-xs">
                      价格带 <span className="text-muted-foreground">（可选）</span>
                    </Label>
                    <Input
                      id="priceBand"
                      value={priceBand}
                      onChange={(e) => setPriceBand(e.target.value)}
                      placeholder="$15-30"
                      disabled={submitting}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">目标平台 <span className="text-muted-foreground">（多选，仅启用已接入真实抓取的平台）</span></Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PLATFORM_OPTIONS.map((p) => {
                      const on = platforms.includes(p.id);
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => togglePlatform(p.id)}
                          disabled={submitting || !p.fetchable}
                          title={p.fetchable ? '已接入真实抓取' : '暂未接入真实抓取，不能用于选品研究'}
                          className={`rounded-md px-3 py-1 text-xs ring-1 transition-colors ${
                            !p.fetchable
                              ? 'cursor-not-allowed bg-muted text-muted-foreground/70 ring-border'
                              : on
                              ? 'bg-foreground text-background ring-foreground'
                              : 'bg-background text-foreground ring-border hover:bg-foreground/5'
                          }`}
                        >
                          {p.label}{p.fetchable ? '' : '（未接入）'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto] md:items-end">
                  <div>
                    <Label htmlFor="strategy" className="text-xs">
                      选品策略
                    </Label>
                    <select
                      id="strategy"
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                      disabled={submitting}
                      className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      {STRATEGY_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
                      <input
                        type="checkbox"
                        checked={hotSellingOnly}
                        onChange={(event) => setHotSellingOnly(event.target.checked)}
                        disabled={submitting}
                        className="size-3.5"
                      />
                      按热销分排序
                      <span className="text-muted-foreground">
                        不缩小采集范围，只按公开热度信号排序
                      </span>
                    </label>
                  </div>
                  <div>
                    <Label htmlFor="discover-sample-count" className="text-xs">
                      采集商品数
                    </Label>
                    <Input
                      id="discover-sample-count"
                      type="number"
                      min={3}
                      max={30}
                      step={1}
                      value={sampleCount}
                      disabled={submitting}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        setSampleCount(Math.min(Math.max(Math.floor(next), 3), 30));
                      }}
                      className="mt-2 h-9 text-sm"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      默认 12，最多 30
                    </p>
                  </div>
                  <Button type="submit" disabled={submitting} className="h-9">
                    {submitting ? (
                      <>
                        <Loader2 className="size-3 animate-spin" /> 研究中
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3" /> 开始研究
                      </>
                    )}
                  </Button>
                </div>
              </form>

              <p className="mt-3 text-xs text-muted-foreground">
                AI 会优先复用 Lumos 浏览器设置抓取目标平台搜索结果（真实商品标题、价格、评分、评论数、主图）和可打开的商品详情页（图库、卖点、描述、品牌/店铺），把这些样品与详情作为评分依据。
                <strong className="text-foreground">
                  如果所有平台都抓不到（反爬 / 中国大陆访问 amazon.com 无 VPN /
                  HTTP 错误），系统会拒绝出候选并报错</strong>，
                而不是退回模型估算编造虚构产品糊弄你。每张候选卡顶部显示真实样品来源，可点开核实。
              </p>
              {error ? (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle />
                  <AlertTitle>研究失败</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      <ResearchWorkspace
        loading={loading}
        runs={researchRuns}
        detailMode={detailMode}
        detailRun={detailResearch}
        selectedIds={selectedIds}
        comparing={comparing}
        batchPromoting={batchPromoting}
        batchProgress={batchProgress}
        batchSummary={batchSummary}
        onOpenRun={setDetailResearchId}
        onBack={() => {
          setDetailResearchId(null);
          clearSelection();
        }}
        onClearSelection={clearSelection}
        onCompare={runCompare}
        onBatchPromote={runBatchPromote}
        onToggleCandidate={toggleSelect}
        onChanged={onChanged}
        onSwitchToStudio={onSwitchToStudio}
      />

      <CompareDialog
        open={compareOpen}
        loading={comparing}
        result={compareResult}
        error={compareError}
        candidatesById={candidatesById}
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}

function ResearchWorkspace({
  loading,
  runs,
  detailMode,
  detailRun,
  selectedIds,
  comparing,
  batchPromoting,
  batchProgress,
  batchSummary,
  onOpenRun,
  onBack,
  onClearSelection,
  onCompare,
  onBatchPromote,
  onToggleCandidate,
  onChanged,
  onSwitchToStudio,
}: {
  loading: boolean;
  runs: ResearchRun[];
  detailMode: boolean;
  detailRun: ResearchRun | null;
  selectedIds: Set<string>;
  comparing: boolean;
  batchPromoting: boolean;
  batchProgress: { done: number; total: number } | null;
  batchSummary: string | null;
  onOpenRun: (id: string) => void;
  onBack: () => void;
  onClearSelection: () => void;
  onCompare: () => void;
  onBatchPromote: () => void;
  onToggleCandidate: (id: string, on: boolean) => void;
  onChanged: () => void;
  onSwitchToStudio: () => void;
}): React.ReactElement {
  if (detailMode) {
    if (!detailRun) {
      return <ResearchDetailLoadingPage loading={loading} onBack={onBack} />;
    }
    return (
      <ResearchDetailPage
        run={detailRun}
        selectedIds={selectedIds}
        comparing={comparing}
        batchPromoting={batchPromoting}
        batchProgress={batchProgress}
        batchSummary={batchSummary}
        onBack={onBack}
        onClearSelection={onClearSelection}
        onCompare={onCompare}
        onBatchPromote={onBatchPromote}
        onToggleCandidate={onToggleCandidate}
        onChanged={onChanged}
        onSwitchToStudio={onSwitchToStudio}
      />
    );
  }

  return <ResearchListPage loading={loading} runs={runs} onOpenRun={onOpenRun} />;
}

function ResearchDetailLoadingPage({
  loading,
  onBack,
}: {
  loading: boolean;
  onBack: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-3" />
            返回列表
          </Button>
          <Layers3 className="size-4" />
          研究详情
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="py-12 text-center text-sm text-muted-foreground">
          {loading ? '研究详情加载中…' : '这条研究记录暂时不可用，请返回列表刷新后重试。'}
        </p>
      </CardContent>
    </Card>
  );
}

function ResearchListPage({
  loading,
  runs,
  onOpenRun,
}: {
  loading: boolean;
  runs: ResearchRun[];
  onOpenRun: (id: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2">
            <Calendar className="size-4" /> 研究记录
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {runs.length ? `${runs.length} 条研究` : '暂无研究'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && runs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载研究记录中…</p>
        ) : runs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            还没有研究记录。先从上方发起一次选品研究。
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left text-xs">
                <thead className="bg-muted/60 text-[11px] text-muted-foreground">
                  <tr>
                    <EvidenceTh className="w-[300px]">研究关键词</EvidenceTh>
                    <EvidenceTh className="w-[230px]">市场 / 平台</EvidenceTh>
                    <EvidenceTh className="w-[90px]">样品</EvidenceTh>
                    <EvidenceTh className="w-[90px]">详情页</EvidenceTh>
                    <EvidenceTh className="w-[90px]">候选</EvidenceTh>
                    <EvidenceTh className="w-[110px]">状态</EvidenceTh>
                    <EvidenceTh className="w-[160px]">更新时间</EvidenceTh>
                    <EvidenceTh className="w-[120px]">操作</EvidenceTh>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="cursor-pointer border-t align-middle hover:bg-foreground/[0.02]"
                      onClick={() => onOpenRun(run.id)}
                    >
                      <EvidenceTd>
                        <p className="text-sm font-semibold">{run.keyword}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {strategyLabel(run.strategy)}
                          {run.priceBand ? ` · ${run.priceBand}` : ''}
                        </p>
                      </EvidenceTd>
                      <EvidenceTd>
                        <p className="text-foreground/80">{run.market}</p>
                        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                          {run.platforms.map(platformLabel).join('、') || '目标平台'}
                        </p>
                      </EvidenceTd>
                      <EvidenceTd>
                        <span className="font-semibold tabular-nums">{run.sampleCount}</span>
                      </EvidenceTd>
                      <EvidenceTd>
                        <span className="font-semibold tabular-nums">{run.detailCount}</span>
                      </EvidenceTd>
                      <EvidenceTd>
                        <span className="font-semibold tabular-nums">{run.candidates.length}</span>
                      </EvidenceTd>
                      <EvidenceTd>
                        <ResearchStatusBadge status={run.status} />
                        {run.failureReason ? (
                          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-destructive">
                            {compactReason(run.failureReason)}
                          </p>
                        ) : null}
                      </EvidenceTd>
                      <EvidenceTd>
                        <span className="text-muted-foreground">{formatDateTime(run.updatedAt)}</span>
                      </EvidenceTd>
                      <EvidenceTd>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRun(run.id);
                          }}
                        >
                          详情
                          <ArrowRight className="size-3" />
                        </Button>
                      </EvidenceTd>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchDetailPage({
  run,
  selectedIds,
  comparing,
  batchPromoting,
  batchProgress,
  batchSummary,
  onBack,
  onClearSelection,
  onCompare,
  onBatchPromote,
  onToggleCandidate,
  onChanged,
  onSwitchToStudio,
}: {
  run: ResearchRun;
  selectedIds: Set<string>;
  comparing: boolean;
  batchPromoting: boolean;
  batchProgress: { done: number; total: number } | null;
  batchSummary: string | null;
  onBack: () => void;
  onClearSelection: () => void;
  onCompare: () => void;
  onBatchPromote: () => void;
  onToggleCandidate: (id: string, on: boolean) => void;
  onChanged: () => void;
  onSwitchToStudio: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span className="flex min-w-0 items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-3" />
              返回列表
            </Button>
            <span className="flex min-w-0 items-center gap-2">
              <Layers3 className="size-4 shrink-0" />
              <span className="truncate">研究详情</span>
              <span className="truncate text-[11px] font-normal text-muted-foreground">
                {run.keyword} / {run.market}
              </span>
            </span>
          </span>
          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onClearSelection}>
                清除
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedIds.size < 2 || selectedIds.size > 6 || comparing || batchPromoting}
                onClick={onCompare}
                title={
                  selectedIds.size < 2
                    ? '至少选 2 个'
                    : selectedIds.size > 6
                    ? '最多 6 个'
                    : 'AI 对比并推荐'
                }
              >
                {comparing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <GitCompare className="size-3" />
                )}
                AI 对比 ({selectedIds.size})
              </Button>
              <Button
                size="sm"
                disabled={selectedIds.size > 6 || batchPromoting || comparing}
                onClick={onBatchPromote}
                title={selectedIds.size > 6 ? '最多 6 个' : '批量转入工坊（每条 ~30s）'}
              >
                {batchPromoting ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    转入中
                    {batchProgress ? ` (${batchProgress.done}/${batchProgress.total})` : ''}
                  </>
                ) : (
                  <>
                    <ArrowRight className="size-3" />
                    批量转入 ({selectedIds.size})
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {batchSummary ? (
          <Alert className="mb-3">
            <AlertDescription className="text-xs">{batchSummary}</AlertDescription>
          </Alert>
        ) : null}
        <ResearchDetail
          run={run}
          selectedIds={selectedIds}
          onToggleCandidate={onToggleCandidate}
          onChanged={onChanged}
          onSwitchToStudio={onSwitchToStudio}
        />
      </CardContent>
    </Card>
  );
}

function ResearchDetail({
  run,
  selectedIds,
  onToggleCandidate,
  onChanged,
  onSwitchToStudio,
}: {
  run: ResearchRun;
  selectedIds: Set<string>;
  onToggleCandidate: (id: string, on: boolean) => void;
  onChanged: () => void;
  onSwitchToStudio: () => void;
}): React.ReactElement {
  const insights = deriveResearchInsights(run);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-foreground/[0.02] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">本次研究任务</p>
            <h3 className="mt-1 text-lg font-semibold leading-tight">
              {run.keyword} / {run.market} / {strategyLabel(run.strategy)}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              平台：{run.platforms.map(platformLabel).join('、') || '目标平台'}
              {run.priceBand ? ` · 价格带：${run.priceBand}` : ''}
              {run.hotSellingOnly ? ' · 按热销分排序' : ''}
              {' · '}
              {formatDateTime(run.createdAt)}
            </p>
          </div>
          <ResearchStatusBadge status={run.status} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <ResearchStat icon={<Search className="size-3.5" />} label="原始样品" value={`${run.sampleCount}`} />
          <ResearchStat icon={<Eye className="size-3.5" />} label="打开详情" value={`${run.detailCount}`} />
          <ResearchStat icon={<PackageCheck className="size-3.5" />} label="候选方案" value={`${run.candidates.length}`} />
          <ResearchStat icon={<Target className="size-3.5" />} label="决策状态" value={run.status} />
        </div>
        {run.status === '研究中' ? (
          <Alert className="mt-4 border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
            <Loader2 className="size-4 animate-spin" />
            <AlertTitle className="text-xs">研究正在执行</AlertTitle>
            <AlertDescription className="text-xs">
              已创建研究记录，页面会自动刷新。采集完成后会补上原始竞品样本池、市场洞察和产品候选。
            </AlertDescription>
          </Alert>
        ) : null}
        {run.failureReason ? (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="size-4" />
            <AlertTitle className="text-xs">研究失败原因</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap text-xs">
              {run.failureReason}
            </AlertDescription>
          </Alert>
        ) : null}
        {run.failedSources.length ? (
          <Alert className="mt-4 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertCircle className="size-4" />
            <AlertTitle className="text-xs">部分平台没有拿到可用样品</AlertTitle>
            <AlertDescription className="text-xs">
              {run.failedSources.map((item) => `${platformLabel(item.source)}：${item.reason}`).join('；')}
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      <Tabs defaultValue="collection" className="gap-4">
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="collection">
              <Table2 className="size-3.5" />
              采集详情
            </TabsTrigger>
            <TabsTrigger value="sop">
              <Layers3 className="size-3.5" />
              SOP 复盘
            </TabsTrigger>
            <TabsTrigger value="insights">
              <BarChart3 className="size-3.5" />
              市场洞察
            </TabsTrigger>
            <TabsTrigger value="candidates">
              <Sparkles className="size-3.5" />
              产品候选
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="collection" className="mt-0">
          <CollectionEvidenceTab run={run} />
        </TabsContent>

        <TabsContent value="sop" className="mt-0">
          <section>
            <SectionHeader
              icon={<Layers3 className="size-4" />}
              title="SOP 复盘"
              description="当前先把采集证据前置；完整手册流程会继续拆成可验收步骤。"
            />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <InsightCard
                item={{
                  title: '第一步',
                  value: '先验采集质量',
                  detail: '必须先确认标题、价格、图片、review、详情页证据是否足够，再进入分析。',
                  tone: 'blue',
                }}
              />
              <InsightCard
                item={{
                  title: '当前状态',
                  value: run.sampleCount > 0 ? '已有原始样本池' : '缺少原始样本',
                  detail: '采集详情 Tab 是后续所有市场判断、差异化和立项建议的证据底座。',
                  tone: run.sampleCount > 0 ? 'green' : 'amber',
                }}
              />
            </div>
          </section>
        </TabsContent>

        <TabsContent value="insights" className="mt-0">
          <section>
            <SectionHeader
              icon={<BarChart3 className="size-4" />}
              title="市场洞察"
              description="按手册先判断搜索需求、竞争强度、价格带和痛点来源，不直接跳到 AI 结论。"
            />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {insights.map((insight) => (
                <InsightCard key={insight.title} item={insight} />
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="candidates" className="mt-0">
          <section>
            <SectionHeader
              icon={<Sparkles className="size-4" />}
              title="产品立项候选"
              description="每个候选按“做什么、对标谁、怎么改、先验证什么、利润是否待补”来读。"
            />
            {run.candidates.length === 0 ? (
              <EmptyBlock text="本次研究没有生成候选。请查看上方失败原因后重新研究。" />
            ) : (
              <ul className="mt-3 grid grid-cols-1 gap-3 2xl:grid-cols-2">
                {run.candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    researchSamples={run.samples}
                    onChanged={onChanged}
                    onSwitchToStudio={onSwitchToStudio}
                    selected={selectedIds.has(candidate.id)}
                    onToggleSelect={(on) => onToggleCandidate(candidate.id, on)}
                  />
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CandidateCard({
  candidate,
  researchSamples = [],
  onChanged,
  onSwitchToStudio,
  selected,
  onToggleSelect,
}: {
  candidate: DiscoverCandidate;
  researchSamples?: ResearchSample[];
  onChanged: () => void;
  onSwitchToStudio: () => void;
  selected: boolean;
  onToggleSelect: (on: boolean) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [busyMsg, setBusyMsg] = React.useState<string | null>(null);
  const [promoteError, setPromoteError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const points = parseList<string>(candidate.selling_points);
  const risks = parseList<string>(candidate.risks);
  const refs = parseList<DiscoverReferenceUrl>(candidate.reference_urls);
  const sources = parseList<DiscoverReferenceUrl>(candidate.source_search_urls);
  const sourceEntries = parseList<SourceEntry>(candidate.sources);
  const liveSampleEntries = sourceEntries.filter((e) => e.kind === 'live-fetch');
  const totalLiveSamples = liveSampleEntries.reduce(
    (sum, e) => sum + (e.sample_count ?? 0),
    0,
  );
  const totalLiveDetails = liveSampleEntries.reduce(
    (sum, e) => sum + (e.details?.length ?? 0),
    0,
  );
  const strategyEntry = sourceEntries.find((e) => e.kind === 'selection-strategy');
  const evidenceSourceNames = liveSampleEntries.map((e) => platformLabel(e.source)).join('、');
  const scoreSummary = buildScoreSummary(candidate);
  const decision = buildDecisionGrade(candidate);
  const supportSamples = pickSupportSamples(candidate, researchSamples);
  const differentiation = buildDifferentiationSections(candidate, supportSamples, points, risks);
  const listingKeywords = buildListingKeywords(candidate, supportSamples);

  const [editForm, setEditForm] = React.useState({
    product_name: candidate.product_name,
    category: candidate.category,
    summary: candidate.summary ?? '',
    differentiation: candidate.differentiation ?? '',
    estimated_price_usd: candidate.estimated_price_usd?.toString() ?? '',
    selling_points: points.join('\n'),
    risks: risks.join('\n'),
  });

  React.useEffect(() => {
    setEditForm({
      product_name: candidate.product_name,
      category: candidate.category,
      summary: candidate.summary ?? '',
      differentiation: candidate.differentiation ?? '',
      estimated_price_usd: candidate.estimated_price_usd?.toString() ?? '',
      selling_points: parseList<string>(candidate.selling_points).join('\n'),
      risks: parseList<string>(candidate.risks).join('\n'),
    });
  }, [
    candidate.product_name,
    candidate.category,
    candidate.summary,
    candidate.differentiation,
    candidate.estimated_price_usd,
    candidate.selling_points,
    candidate.risks,
  ]);

  const saveEdit = async () => {
    setEditError(null);
    setSavingEdit(true);
    try {
      const priceParsed = editForm.estimated_price_usd
        ? Number(editForm.estimated_price_usd)
        : undefined;
      const res = await fetch(`/api/apps/builtin/ecommerce/discover/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: editForm.product_name,
          category: editForm.category,
          summary: editForm.summary,
          differentiation: editForm.differentiation,
          estimated_price_usd:
            priceParsed && Number.isFinite(priceParsed) ? priceParsed : undefined,
          selling_points: editForm.selling_points
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          risks: editForm.risks.split('\n').map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setEditError(json.error ?? `保存失败 (${res.status})`);
        return;
      }
      setEditing(false);
      onChanged();
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async () => {
    if (!confirm('删除这个候选？候选删除后不可恢复（已 promoted 的候选无法删除）。')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/discover/${candidate.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        alert(json.error ?? `删除失败 (${res.status})`);
        return;
      }
      onChanged();
    } finally {
      setDeleting(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    setBusyMsg('生成概念图中…');
    setPromoteError(null);
    try {
      const res = await fetch(
        `/api/apps/builtin/ecommerce/discover/${candidate.id}/promote`,
        { method: 'POST' },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        concept_image_failed?: string;
      };
      if (!res.ok) {
        setPromoteError(json.error ?? `转入失败 (${res.status})`);
        return;
      }
      if (json.concept_image_failed) {
        setPromoteError(`已转入工坊，但概念图生成失败：${json.concept_image_failed}。请到工坊补主图。`);
      }
      onChanged();
      if (!json.concept_image_failed) onSwitchToStudio();
    } finally {
      setBusy(false);
      setBusyMsg(null);
    }
  };

  const promoted = candidate.status === 'promoted';
  const failed = candidate.status === 'failed';
  const researching = candidate.status === 'researching';

  return (
    <li
      className={`rounded-lg border bg-background p-4 ${
        selected ? 'ring-2 ring-foreground' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {!promoted && !researching && !failed ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect(e.target.checked)}
            className="mt-1 size-3.5 shrink-0 cursor-pointer"
            title="选中以加入对比"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">产品立项卡</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug">{candidate.product_name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {candidate.category} · {candidate.market}
            {candidate.estimated_price_usd ? ` · ~$${candidate.estimated_price_usd}` : ''}
          </p>
        </div>
        <DecisionBadge decision={decision} />
      </div>

      {researching ? (
        <p className="mt-3 text-xs text-muted-foreground">研究中…</p>
      ) : failed ? (
        <p className="mt-3 text-xs text-destructive">
          失败：{candidate.failure_reason ?? '未知错误'}
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-md bg-foreground/[0.03] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">立项结论</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                  {candidate.summary || '这个方向基于抓到的竞品样品生成，建议先核实供应链、成本和合规风险。'}
                </p>
              </div>
              {candidate.score_total != null ? (
                <span className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border">
                  综合 {candidate.score_total}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] font-medium text-foreground/80">
              下一步：{decision.nextAction}
            </p>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <BriefItem label="目标人群 / 场景" value={inferTargetAndScene(candidate, points)} />
            <BriefItem label="规格建议" value={inferSpecSuggestion(candidate, points)} />
            <BriefItem label="视觉方向" value={inferVisualDirection(supportSamples)} />
            <BriefItem label="英文关键词方向" value={listingKeywords.join(', ')} />
          </div>

          {supportSamples.length ? (
            <div className="mt-3 rounded-md border bg-background p-3">
              <p className="text-xs font-semibold">对标竞品</p>
              <ul className="mt-2 space-y-1.5">
                {supportSamples.slice(0, expanded ? 4 : 2).map((sample) => (
                  <li key={sample.id} className="flex gap-2 text-[11px] text-foreground/75">
                    <span className="shrink-0 text-muted-foreground">{platformLabel(sample.platform)}</span>
                    <span className="line-clamp-2">
                      {sample.title}
                      {sample.price ? ` · ${sample.price}` : ''}
                      {sample.reviews ? ` · ${sample.reviews} reviews` : ''}
                      {sample.sales ? ` · ${sample.sales}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">差异化拆解</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <BriefItem label="竞品问题" value={differentiation.competitorProblem} tone="green" />
              <BriefItem label="我们怎么改" value={differentiation.proposedChange} tone="green" />
              <BriefItem label="为什么可能卖" value={differentiation.whyItMaySell} tone="green" />
              <BriefItem label="先验证" value={differentiation.validation} tone="green" />
            </div>
            {candidate.differentiation ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-emerald-800/80 hover:text-emerald-950 dark:text-emerald-100/80">
                  查看原始 AI 差异化说明
                </summary>
                <p className="mt-1 leading-relaxed text-emerald-950/80 dark:text-emerald-100/80">
                  {candidate.differentiation}
                </p>
              </details>
            ) : null}
          </div>

          <div className="mt-3 rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <DollarSign className="size-3.5" />
              利润测算
            </div>
            <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
              <MetricCell label="建议售价" value={candidate.estimated_price_usd ? `$${candidate.estimated_price_usd}` : '待估'} />
              <MetricCell label="目标毛利" value=">=30%" />
              <MetricCell label="成本状态" value="待补" />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              按手册，真正立项前还要补采购/制作成本、包装、物流、平台费和广告预算；当前不能把分数当成确定利润。
            </p>
          </div>

          {scoreSummary.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
                展开评分依据
              </summary>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {scoreSummary.map((item) => (
                  <PlainScore key={item.label} {...item} />
                ))}
              </div>
            </details>
          ) : null}

          {(points.length > 0 || risks.length > 0 || supportSamples.length > 2) ? (
            <button
              type="button"
              className="mt-2 text-[11px] text-foreground/60 hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? '收起更多依据' : '展开更多依据'}
            </button>
          ) : null}

          {totalLiveSamples > 0 ? (
            <div className="mt-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-semibold">
                依据：已抓取 {evidenceSourceNames || '目标平台'} {totalLiveSamples} 个真实商品
                {totalLiveDetails > 0 ? `，并打开 ${totalLiveDetails} 个详情页` : ''}
              </p>
              {strategyEntry ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  当前按「{strategyEntry.label ?? candidate.strategy ?? '选品'}」策略排序：{strategyExplanation(candidate.strategy, strategyEntry.label)}
                </p>
              ) : null}
              {liveSampleEntries[0]?.samples?.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                    查看抓到的竞品样品（{liveSampleEntries[0].samples.length}）
                  </summary>
                  <ul className="mt-2 space-y-1 text-[11px] text-foreground/70">
                    {liveSampleEntries[0].samples.map((s, i) => (
                      <li key={i} className="line-clamp-2">
                        {i + 1}. {s.title}
                        {s.price ? ` · ${s.price}` : ''}
                        {s.rating ? ` · ★${s.rating}` : ''}
                        {s.sales ? ` · ${s.sales}` : ''}
                        {s.url ? ' · 可打开详情' : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {liveSampleEntries[0]?.details?.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                    查看已打开的详情页（{liveSampleEntries[0].details.length}）
                  </summary>
                  <ul className="mt-1 space-y-1 text-[10px] text-foreground/70">
                    {liveSampleEntries[0].details.map((d) => (
                      <li key={`${d.url}-${d.rank}`}>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">
                            #{d.rank ?? '-'} {d.title}
                          </a>
                        ) : (
                          <span>#{d.rank ?? '-'} {d.title}</span>
                        )}
                        {d.price ? ` · ${d.price}` : ''}
                        {d.rating ? ` · ★${d.rating}` : ''}
                        {d.sales ? ` · ${d.sales}` : ''}
                        {d.brand ? ` · ${d.brand}` : ''}
                        {d.bullet_points?.length ? ` · ${d.bullet_points[0]}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : sourceEntries.some((e) => e.kind === 'live-fetch-failed') ? (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-[11px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900">
              注意：部分平台抓取失败（{sourceEntries
                .filter((e) => e.kind === 'live-fetch-failed')
                .map((e) => `${e.source}: ${e.reason}`)
                .join('；')}）。本条候选基于其余成功平台的真实样品。
            </p>
          ) : sourceEntries.some((e) => e.kind === 'model') ? (
            <p className="mt-3 rounded-md bg-red-50 p-2 text-[11px] text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900">
              注意：这是早期版本（无联网时）AI 模型构造的产品概念，<strong>非真实在售商品</strong>，
              可能搜不到。建议重新跑一次研究以获取联网真实数据。
            </p>
          ) : null}

          {refs.length ? (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">去平台核实需求</p>
              <div className="flex flex-wrap gap-1.5">
                {refs.map((r, i) => (
                  <UrlChip key={`ref-${i}`} entry={r} />
                ))}
              </div>
            </div>
          ) : null}
          {sources.length ? (
            <div className="mt-2">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">去货源平台找供应商</p>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((r, i) => (
                  <UrlChip key={`src-${i}`} entry={r} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {promoteError ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription className="text-[11px]">{promoteError}</AlertDescription>
        </Alert>
      ) : null}

      {editing ? (
        <div className="mt-3 space-y-2 rounded-md border-t pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">候选名</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={editForm.product_name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, product_name: e.target.value }))
                }
                disabled={savingEdit}
              />
            </div>
            <div>
              <Label className="text-[11px]">类目</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                disabled={savingEdit}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-[11px]">预估价 (USD, 可选)</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={editForm.estimated_price_usd}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, estimated_price_usd: e.target.value }))
                }
                placeholder="20"
                disabled={savingEdit}
              />
            </div>
          </div>
          <div>
            <Label className="text-[11px]">摘要</Label>
            <Textarea
              className="mt-1 text-xs"
              value={editForm.summary}
              onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
              disabled={savingEdit}
              rows={2}
            />
          </div>
          <div>
            <Label className="text-[11px]">差异化</Label>
            <Textarea
              className="mt-1 text-xs"
              value={editForm.differentiation}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, differentiation: e.target.value }))
              }
              disabled={savingEdit}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">卖点（每行一条）</Label>
              <Textarea
                className="mt-1 text-xs"
                value={editForm.selling_points}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, selling_points: e.target.value }))
                }
                disabled={savingEdit}
                rows={3}
              />
            </div>
            <div>
              <Label className="text-[11px]">风险（每行一条）</Label>
              <Textarea
                className="mt-1 text-xs"
                value={editForm.risks}
                onChange={(e) => setEditForm((f) => ({ ...f, risks: e.target.value }))}
                disabled={savingEdit}
                rows={3}
              />
            </div>
          </div>
          {editError ? (
            <p className="text-[11px] text-destructive">{editError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {candidate.concept_image_path ? (
            <>
              <ImageIcon className="size-3" /> 已生成概念图
            </>
          ) : (
            <>关键词：{candidate.keyword}</>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={savingEdit}
                onClick={() => setEditing(false)}
              >
                <X className="size-3" /> 取消
              </Button>
              <Button size="sm" disabled={savingEdit} onClick={saveEdit}>
                {savingEdit ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                保存
              </Button>
            </>
          ) : (
            <>
              {!promoted && !researching && !failed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                  title="编辑候选"
                >
                  <Edit3 className="size-3" />
                </Button>
              ) : null}
              {!promoted ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || deleting}
                  onClick={remove}
                  title="删除候选"
                >
                  {deleting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3 text-muted-foreground" />
                  )}
                </Button>
              ) : null}
              {promoted ? (
                <span className="text-[11px] text-emerald-600">已转入工坊</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || researching || failed}
                  onClick={promote}
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      {busyMsg ?? '处理中'}
                    </>
                  ) : (
                    <>
                  <ArrowRight className="size-3" />
                      转入工坊制作
                    </>
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function UrlChip({ entry }: { entry: DiscoverReferenceUrl }): React.ReactElement {
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:bg-foreground/5"
    >
      <ExternalLink className="size-2.5" />
      {entry.platform}
    </a>
  );
}

function ResearchStatusBadge({ status }: { status: ResearchRun['status'] }): React.ReactElement {
  const cls =
    status === '已完成'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
      : status === '研究中'
      ? 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900'
      : 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900';
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ring-1 ${cls}`}>
      {status}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: DecisionGrade }): React.ReactElement {
  return (
    <div className={`shrink-0 rounded-md px-2.5 py-1 text-xs ring-1 ${decision.className}`}>
      <span className="font-semibold">{decision.grade}档</span>
      <span className="opacity-80"> {decision.label}</span>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-md bg-foreground/[0.03] px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ResearchStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }): React.ReactElement {
  return (
    <div className="mt-3 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function CollectionEvidenceTab({ run }: { run: ResearchRun }): React.ReactElement {
  const [previewImage, setPreviewImage] = React.useState<{ url: string; title: string } | null>(
    null,
  );
  const totalImages = run.samples.reduce((sum, sample) => sum + sample.imageUrls.length, 0);
  const samplesWithReviews = run.samples.filter((sample) => sample.reviews).length;
  const samplesWithSales = run.samples.filter((sample) => sample.sales || sample.badges.length).length;
  const samplesWithDetails = run.samples.filter((sample) => sample.detailStatus === '详情页已打开').length;

  return (
    <section>
      <SectionHeader
        icon={<Table2 className="size-4" />}
        title="原始竞品样本池"
        description="这里先像表格一样验采集质量：商品是否真实、图片是否够、价格和评论有没有拿到。"
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        <ResearchStat icon={<PackageCheck className="size-3.5" />} label="商品行数" value={`${run.sampleCount}`} />
        <ResearchStat icon={<Images className="size-3.5" />} label="图片证据" value={`${totalImages}`} />
        <ResearchStat icon={<Eye className="size-3.5" />} label="详情页" value={`${samplesWithDetails}`} />
        <ResearchStat icon={<MessageSquareText className="size-3.5" />} label="评论数" value={`${samplesWithReviews}`} />
        <ResearchStat icon={<Award className="size-3.5" />} label="销量/热销" value={`${samplesWithSales}`} />
      </div>
      {run.hotSellingOnly ? (
        <Alert className="mt-3 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <Award className="size-4" />
          <AlertTitle className="text-xs">已按热销分排序</AlertTitle>
          <AlertDescription className="text-xs">
            采集范围不会只保留 Bestseller。热销分只使用 Etsy 当场可见的 Bestseller、自然排名、评论、评分、浏览/加购/收藏等公开信号；不是商品真实销量。
          </AlertDescription>
        </Alert>
      ) : null}
      {run.detailWarnings.length ? (
        <Alert className="mt-3 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertCircle className="size-4" />
          <AlertTitle className="text-xs">详情页采集警告</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap text-xs">
            {run.detailWarnings.join('\n')}
          </AlertDescription>
        </Alert>
      ) : null}

      {run.samples.length === 0 ? (
        <div className="space-y-3">
          <EmptyBlock
            text={
              run.status === '研究中'
                ? '正在采集竞品样本。页面会自动刷新，采到后这里会出现图片、标题、价格、评论数、销量信号和原始链接。'
                : '这条研究没有保存原始样品。重新研究后会显示标题、关键词、价格、图片、评论数和原始链接。'
            }
          />
          {run.failureReason ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle className="text-xs">没有样品的原因</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap text-xs">
                {run.failureReason}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1980px] table-fixed border-collapse text-left text-xs">
              <thead className="bg-muted/60 text-[11px] text-muted-foreground">
                <tr>
                  <EvidenceTh className="w-[74px]">序号</EvidenceTh>
                  <EvidenceTh className="w-[150px]">热销分</EvidenceTh>
                  <EvidenceTh className="w-[360px]">标题 / 商品 ID</EvidenceTh>
                  <EvidenceTh className="w-[200px]">关键词</EvidenceTh>
                  <EvidenceTh className="w-[130px]">价格</EvidenceTh>
                  <EvidenceTh className="w-[160px]">评分 / 评论</EvidenceTh>
                  <EvidenceTh className="w-[190px]">销量 / 热销</EvidenceTh>
                  <EvidenceTh className="w-[200px]">品牌 / 类目</EvidenceTh>
                  <EvidenceTh className="w-[330px]">详情内容</EvidenceTh>
                  <EvidenceTh className="w-[176px]">链接 / 状态</EvidenceTh>
                </tr>
              </thead>
              <tbody>
                {run.samples.map((sample, index) => (
                  <React.Fragment key={sample.id}>
                    {index > 0 ? (
                      <tr aria-hidden="true">
                        <td colSpan={10} className="h-3 bg-muted/60 p-0" />
                      </tr>
                    ) : null}
                    <tr className="border-t border-border bg-muted/25">
                      <td colSpan={10} className="border-l-4 border-l-foreground/35 px-3 py-3">
                        <ProductImageStrip
                          sample={sample}
                          rankLabel={`#${sample.rank ?? index + 1}`}
                          onPreview={(url) => setPreviewImage({ url, title: sample.title })}
                        />
                      </td>
                    </tr>
                    <tr className="border-y align-top hover:bg-foreground/[0.02]">
                      <EvidenceTd>
                        <div className="font-semibold tabular-nums">#{sample.rank ?? index + 1}</div>
                        <div className="mt-1 rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {platformLabel(sample.platform)}
                        </div>
                        {sample.sponsored ? (
                          <div className="mt-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900">
                            广告位
                          </div>
                        ) : null}
                      </EvidenceTd>
                      <EvidenceTd>
                        <HeatScoreCell sample={sample} />
                      </EvidenceTd>
                      <EvidenceTd>
                        <p className="line-clamp-3 font-medium leading-relaxed text-foreground">
                          {sample.title}
                        </p>
                        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          <p>ID：{sample.productId || '未采到'}</p>
                          <p>来源：{sample.detailStatus}</p>
                        </div>
                      </EvidenceTd>
                      <EvidenceTd>
                        <div className="space-y-1">
                          <span className="inline-flex rounded-md bg-foreground/[0.04] px-2 py-1 text-[11px]">
                            搜索：{sample.sourceKeyword}
                          </span>
                          {sample.keywordTags.length ? (
                            <div className="flex flex-wrap gap-1">
                              {sample.keywordTags.slice(0, 6).map((tag) => (
                                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">标题关键词待补充</p>
                          )}
                        </div>
                      </EvidenceTd>
                      <EvidenceTd>
                        <FieldValue value={sample.price} empty="未采到价格" strong />
                      </EvidenceTd>
                      <EvidenceTd>
                        <div className="space-y-1">
                          <FieldValue value={sample.rating ? `${sample.rating} 星` : null} empty="未采到评分" />
                          <FieldValue value={sample.reviews ? `${sample.reviews} 条评论` : null} empty="未采到评论数" />
                        </div>
                      </EvidenceTd>
                      <EvidenceTd>
                        <div className="space-y-1">
                          <FieldValue value={sample.sales} empty="未采到销量" strong />
                          {sample.badges.length ? (
                            <div className="flex flex-wrap gap-1">
                              {sample.badges.slice(0, 4).map((badge) => (
                                <span key={badge} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900">
                                  {badge}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">热销标识未采到</p>
                          )}
                        </div>
                      </EvidenceTd>
                      <EvidenceTd>
                        <div className="space-y-1">
                          <FieldValue value={sample.brand} empty="品牌/店铺未采到" />
                          <FieldValue value={sample.category} empty="类目未采到" />
                          <FieldValue value={sample.availability} empty="库存状态未采到" />
                        </div>
                      </EvidenceTd>
                      <EvidenceTd>
                        {sample.bulletPoints.length ? (
                          <ul className="space-y-1">
                            {sample.bulletPoints.slice(0, 3).map((point) => (
                              <li key={point} className="line-clamp-2 leading-relaxed text-foreground/75">
                                {point}
                              </li>
                            ))}
                          </ul>
                        ) : sample.description ? (
                          <p className="line-clamp-4 leading-relaxed text-foreground/75">{sample.description}</p>
                        ) : (
                          <p className="text-muted-foreground">详情文案未采到</p>
                        )}
                      </EvidenceTd>
                      <EvidenceTd>
                        <div className="space-y-2">
                          {sample.url ? (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              className="h-8 w-full justify-center gap-1 text-xs"
                              onClick={() => {
                                if (sample.url) void openExternalUrl(sample.url);
                              }}
                            >
                              <ExternalLink className="size-3" />
                              打开原商品
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">无链接</span>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {sample.fetchedVia ? `抓取：${sample.fetchedVia}` : '抓取方式未记录'}
                          </p>
                          {sample.fetchedAt ? (
                            <p className="text-[10px] text-muted-foreground">{formatDateTime(sample.fetchedAt)}</p>
                          ) : null}
                        </div>
                      </EvidenceTd>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ImagePreviewDialog preview={previewImage} onClose={() => setPreviewImage(null)} />
    </section>
  );
}

function EvidenceTh({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <th className={`px-3 py-2 font-medium ${className ?? ''}`}>{children}</th>;
}

function EvidenceTd({ children }: { children: React.ReactNode }): React.ReactElement {
  return <td className="px-3 py-3">{children}</td>;
}

function ProductImageStrip({
  sample,
  rankLabel,
  onPreview,
}: {
  sample: ResearchSample;
  rankLabel: string;
  onPreview: (url: string) => void;
}): React.ReactElement {
  const images = sample.imageUrls.length ? sample.imageUrls : sample.imageUrl ? [sample.imageUrl] : [];

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background tabular-nums">
            商品 {rankLabel}
          </span>
          <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border">
            {platformLabel(sample.platform)}
          </span>
          {sample.sponsored ? (
            <span className="shrink-0 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900">
              广告位
            </span>
          ) : null}
          <p className="min-w-0 truncate text-xs font-medium text-foreground">{sample.title}</p>
        </div>
        <div className="shrink-0 rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border">
          {images.length} 张图
        </div>
      </div>
      <div className="mb-2">
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          图片证据：{sample.detailStatus === '详情页已打开' ? '含详情页图库' : '仅搜索页图'}，点击图片可放大查看
        </p>
      </div>
      {images.length ? (
        <div className="overflow-x-auto pb-1">
          <div className="flex w-max gap-2">
            {images.map((img, index) => (
              <ProductImageTile
                key={`${img}-${index}`}
                imageUrl={img}
                title={sample.title}
                label={index === 0 ? '主图' : `图 ${index + 1}`}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex h-44 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          <ImageIcon className="mr-2 size-4" />
          商品图片未采到
        </div>
      )}
    </div>
  );
}

function ProductImageTile({
  imageUrl,
  title,
  label,
  onPreview,
}: {
  imageUrl: string;
  title: string;
  label: string;
  onPreview: (url: string) => void;
}): React.ReactElement {
  const [failed, setFailed] = React.useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        if (!failed) onPreview(imageUrl);
      }}
      disabled={failed}
      className="group relative flex size-44 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border transition hover:ring-foreground/40 disabled:cursor-not-allowed disabled:hover:ring-border"
      aria-label={failed ? '商品图片加载失败' : '放大查看商品图片'}
    >
      {failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-[11px] text-muted-foreground">
          <ImageIcon className="size-5" />
          <span>图片加载失败</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-foreground shadow-sm">
        {label}
      </span>
      {!failed ? (
        <span className="absolute inset-x-0 bottom-0 bg-foreground/65 px-2 py-1 text-[10px] text-background opacity-0 transition group-hover:opacity-100">
          点击放大
        </span>
      ) : null}
      <span className="sr-only">{title}</span>
    </button>
  );
}

function ImagePreviewDialog({
  preview,
  onClose,
}: {
  preview: { url: string; title: string } | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="line-clamp-2 text-sm">{preview?.title ?? '商品图片'}</DialogTitle>
          <DialogDescription className="sr-only">商品图片预览</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[76vh] items-center justify-center overflow-auto rounded-md bg-muted">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={preview.title}
              className="max-h-[76vh] w-auto max-w-full object-contain"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldValue({
  value,
  empty,
  strong = false,
}: {
  value: string | null | undefined;
  empty: string;
  strong?: boolean;
}): React.ReactElement {
  const displayValue = cleanEvidenceText(value);
  if (!displayValue) {
    return <p className="text-[11px] text-muted-foreground">{empty}</p>;
  }
  return <p className={`${strong ? 'font-semibold text-foreground' : 'text-foreground/75'}`}>{displayValue}</p>;
}

function HeatScoreCell({ sample }: { sample: ResearchSample }): React.ReactElement {
  if (sample.heatScore == null) {
    return (
      <div className="space-y-1 text-[11px] text-muted-foreground">
        <p>未计算</p>
        <p>当前平台暂无热销规则</p>
      </div>
    );
  }
  const tone =
    sample.heatScore >= 70
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
      : sample.heatScore >= 45
        ? 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900'
        : sample.heatScore >= 20
          ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
          : 'bg-muted text-muted-foreground ring-border';
  return (
    <div className="space-y-1.5">
      <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold tabular-nums ring-1 ${tone}`}>
        {sample.heatScore}
      </span>
      <p className="text-[11px] font-medium text-foreground/80">
        {sample.heatLevel ?? '热度'} · 置信度 {sample.heatConfidence ?? '低'}
      </p>
      {sample.heatReasons.length ? (
        <ul className="space-y-0.5 text-[10px] leading-snug text-muted-foreground">
          {sample.heatReasons.slice(0, 3).map((reason) => (
            <li key={reason} className="line-clamp-1">{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function InsightCard({ item }: { item: InsightItem }): React.ReactElement {
  const toneClass =
    item.tone === 'green'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-50'
      : item.tone === 'amber'
      ? 'border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-50'
      : item.tone === 'blue'
      ? 'border-blue-200 bg-blue-50/70 text-blue-950 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-50'
      : 'border-border bg-background text-foreground';
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-75">{item.title}</p>
      <p className="mt-1 text-sm font-semibold">{item.value}</p>
      <p className="mt-1 text-xs leading-relaxed opacity-80">{item.detail}</p>
    </div>
  );
}

function BriefItem({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green';
}): React.ReactElement {
  const cls =
    tone === 'green'
      ? 'bg-white/55 text-emerald-950/85 dark:bg-emerald-950/20 dark:text-emerald-50/85'
      : 'bg-foreground/[0.03] text-foreground/80';
  return (
    <div className={`rounded-md px-2.5 py-2 ${cls}`}>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[12px] leading-relaxed">{value}</p>
    </div>
  );
}

function PlainScore({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}): React.ReactElement {
  const tone = value >= 75 ? 'text-emerald-700' : value >= 55 ? 'text-foreground' : 'text-amber-700';
  return (
    <div className="rounded-md bg-foreground/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${tone}`}>{value}</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-foreground/75">{hint}</p>
    </div>
  );
}

function buildScoreSummary(candidate: DiscoverCandidate): Array<{ label: string; value: number; hint: string }> {
  return [
    {
      label: '市场机会',
      value: candidate.score_demand ?? 0,
      hint: describeScore(candidate.score_demand, '搜索需求较强', '需求一般，先小批量测试', '需求信号偏弱'),
    },
    {
      label: '竞争空间',
      value: candidate.score_competition ?? 0,
      hint: describeScore(candidate.score_competition, '相对没那么卷', '竞争中等，要靠差异化', '竞争很卷，谨慎进入'),
    },
    {
      label: '落地难度',
      value: Math.round(((candidate.score_compliance ?? 0) + (candidate.score_logistics ?? 0)) / 2),
      hint: describeScore(
        Math.round(((candidate.score_compliance ?? 0) + (candidate.score_logistics ?? 0)) / 2),
        '合规和发货相对省心',
        '需要确认材质/包装/物流',
        '合规或物流风险较高',
      ),
    },
  ].filter((item) => item.value > 0);
}

function describeScore(value: number | null | undefined, good: string, mid: string, low: string): string {
  const v = value ?? 0;
  if (v >= 75) return good;
  if (v >= 55) return mid;
  return low;
}

function strategyExplanation(strategy?: string | null, label?: string): string {
  const normalized = strategy ?? label ?? '';
  if (normalized.includes('blue') || normalized.includes('蓝海')) {
    return '优先看竞争空间和差异化，不只看销量。';
  }
  if (normalized.includes('follow') || normalized.includes('跟风')) {
    return '优先看已有需求和可快速跟进的卖点。';
  }
  if (normalized.includes('season') || normalized.includes('季节')) {
    return '优先看近期季节需求和能否赶上销售窗口。';
  }
  if (normalized.includes('big-sale') || normalized.includes('大促')) {
    return '优先看供货稳定、可打折空间和履约能力。';
  }
  if (normalized.includes('evergreen') || normalized.includes('常青')) {
    return '优先看长期稳定需求和低合规风险。';
  }
  return '综合需求、竞争、利润、合规和物流评分排序。';
}

function buildResearchRuns(candidates: DiscoverCandidate[]): ResearchRun[] {
  const groups = new Map<string, DiscoverCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.research_id || `legacy-${candidate.id}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  return Array.from(groups.entries())
    .map(([id, group]) => {
      const sorted = [...group].sort((a, b) => (b.score_total ?? 0) - (a.score_total ?? 0));
      const productCandidates = sorted.filter((candidate) => candidate.product_name !== '研究中…');
      const first = sorted[0];
      const sourceEntries = group.flatMap((candidate) => parseList<SourceEntry>(candidate.sources));
      const hotSellingOnly = sourceEntries.some(
        (entry) => entry.kind === 'research-preferences' && entry.hot_selling_only === true,
      );
      const samples = collectResearchSamples(group, hotSellingOnly);
      const platformFocus = parsePlatformFocus(first?.platform_focus);
      const sourcePlatforms = uniqueStrings(
        sourceEntries
          .map((entry) => entry.source)
          .filter((source): source is string => Boolean(source)),
      );
      const failedSources = uniqueFailures(
        sourceEntries
          .filter((entry) => entry.kind === 'live-fetch-failed')
          .map((entry) => ({
            source: entry.source || '目标平台',
            reason: entry.reason || '空结果',
          })),
      );
      const detailWarnings = uniqueStrings(
        sourceEntries.flatMap((entry) =>
          (entry.detail_warnings ?? []).map((warning) =>
            `${platformLabel(entry.source || '目标平台')} ${warning}`,
          ),
        ),
      );
      const failureReason =
        sorted.find((candidate) => candidate.status === 'failed' && candidate.failure_reason)
          ?.failure_reason ?? null;
      const createdAt = minDate(group.map((candidate) => candidate.created_at));
      const updatedAt = maxDate(group.map((candidate) => candidate.updated_at ?? candidate.created_at));
      return {
        id,
        keyword: first?.keyword || '未命名研究',
        market: first?.market || '未指定市场',
        priceBand: first?.price_band ?? null,
        strategy: first?.strategy ?? null,
        platforms: platformFocus.length ? platformFocus : sourcePlatforms,
        hotSellingOnly,
        status: inferResearchStatus(group),
        candidates: productCandidates,
        samples,
        sampleCount: samples.length,
        detailCount: samples.filter((sample) => sample.detailStatus === '详情页已打开').length,
        failureReason,
        failedSources,
        detailWarnings,
        createdAt,
        updatedAt,
      } satisfies ResearchRun;
    })
    .sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt));
}

function collectResearchSamples(candidates: DiscoverCandidate[], sortByHotSelling: boolean): ResearchSample[] {
  const byKey = new Map<string, ResearchSample>();
  for (const candidate of candidates) {
    const entries = parseList<SourceEntry>(candidate.sources);
    for (const entry of entries) {
      if (entry.kind !== 'live-fetch') continue;
      const platform = entry.source || '目标平台';
      for (const sample of entry.samples ?? []) {
        const normalized = normalizeSample({
          sample,
          platform,
          sourceKeyword: candidate.keyword,
          detailStatus: '搜索页样品',
          fallbackFetchedAt: entry.fetched_at ?? null,
          fallbackFetchedVia: entry.fetched_via ?? null,
        });
        if (!normalized) continue;
        const existing = byKey.get(normalized.id);
        byKey.set(normalized.id, mergeSample(existing, normalized));
      }
      for (const detail of entry.details ?? []) {
        const normalized = normalizeSample({
          sample: detail,
          platform,
          sourceKeyword: candidate.keyword,
          detailStatus: '详情页已打开',
          fallbackFetchedAt: entry.fetched_at ?? null,
          fallbackFetchedVia: entry.fetched_via ?? null,
        });
        if (!normalized) continue;
        const existing = byKey.get(normalized.id);
        byKey.set(normalized.id, mergeSample(existing, normalized));
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (sortByHotSelling) {
      const heatDiff = (b.heatScore ?? -1) - (a.heatScore ?? -1);
      if (heatDiff !== 0) return heatDiff;
    }
    if (a.detailStatus !== b.detailStatus) {
      return a.detailStatus === '详情页已打开' ? -1 : 1;
    }
    return (a.rank ?? 999) - (b.rank ?? 999);
  });
}

function normalizeSample(args: {
  sample: SourceSample | SourceDetail;
  platform: string;
  sourceKeyword: string;
  detailStatus: ResearchSample['detailStatus'];
  fallbackFetchedAt?: string | null;
  fallbackFetchedVia?: string | null;
}): ResearchSample | null {
  const title = cleanEvidenceText(args.sample.title);
  if (!title) return null;
  const url = cleanEvidenceText(args.sample.url)?.trim() || null;
  const detail = args.sample as SourceDetail;
  const productId = cleanEvidenceText(args.sample.product_id);
  const key = productId
    ? `${args.platform}:${productId}`
    : url || `${args.platform}:${title.toLowerCase()}`;
  const imageUrls = uniqueStrings(
    [
    args.sample.image_url ?? args.sample.imageUrl ?? '',
    ...(args.sample.image_urls ?? []),
    ...(detail.gallery_image_urls ?? []),
    ]
      .map((item) => cleanEvidenceText(item))
      .filter((item): item is string => Boolean(item)),
  );
  return {
    id: key,
    platform: args.platform,
    title,
    price: cleanEvidenceText(args.sample.price),
    rating: cleanEvidenceText(args.sample.rating),
    reviews: cleanEvidenceText(args.sample.reviews),
    sales: cleanEvidenceText(args.sample.sales),
    url,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    keywordTags: cleanEvidenceList(args.sample.keyword_tags),
    badges: cleanEvidenceList(args.sample.badges),
    productId,
    sponsored: Boolean(args.sample.sponsored),
    rank: detail.rank ?? null,
    brand: cleanEvidenceText(detail.brand ?? args.sample.brand),
    category: cleanEvidenceText(detail.category ?? args.sample.category),
    availability: cleanEvidenceText(detail.availability),
    description: cleanEvidenceText(detail.description),
    reviewSnippets: cleanEvidenceList(detail.review_snippets),
    fetchedAt: detail.fetched_at ?? args.fallbackFetchedAt ?? null,
    fetchedVia: detail.fetched_via ?? args.fallbackFetchedVia ?? null,
    detailStatus: args.detailStatus,
    sourceKeyword: args.sourceKeyword,
    bulletPoints: cleanEvidenceList(detail.bullet_points),
    heatScore: parseNullableNumber(args.sample.heat_score),
    heatLevel: cleanEvidenceText(args.sample.heat_level),
    heatConfidence: cleanEvidenceText(args.sample.heat_confidence),
    heatReasons: cleanEvidenceList(args.sample.heat_reasons),
  };
}

function mergeSample(
  existing: ResearchSample | undefined,
  next: ResearchSample,
): ResearchSample {
  if (!existing) return next;
  const preferNext = next.detailStatus === '详情页已打开' && existing.detailStatus !== '详情页已打开';
  return {
    ...existing,
    ...next,
    title: preferNext ? next.title : existing.title || next.title,
    price: next.price ?? existing.price,
    rating: next.rating ?? existing.rating,
    reviews: next.reviews ?? existing.reviews,
    sales: next.sales ?? existing.sales,
    imageUrl: next.imageUrl ?? existing.imageUrl,
    imageUrls: preferNext
      ? uniqueStrings([...next.imageUrls, ...existing.imageUrls])
      : uniqueStrings([...existing.imageUrls, ...next.imageUrls]),
    keywordTags: uniqueStrings([...existing.keywordTags, ...next.keywordTags]),
    badges: uniqueStrings([...existing.badges, ...next.badges]),
    heatScore: maxNullable(existing.heatScore, next.heatScore),
    heatLevel: next.heatLevel ?? existing.heatLevel,
    heatConfidence: next.heatConfidence ?? existing.heatConfidence,
    heatReasons: uniqueStrings([...existing.heatReasons, ...next.heatReasons]),
    productId: next.productId ?? existing.productId,
    sponsored: existing.sponsored || next.sponsored,
    brand: next.brand ?? existing.brand,
    category: next.category ?? existing.category,
    availability: next.availability ?? existing.availability,
    description: next.description ?? existing.description,
    reviewSnippets: next.reviewSnippets.length ? next.reviewSnippets : existing.reviewSnippets,
    fetchedAt: next.fetchedAt ?? existing.fetchedAt,
    fetchedVia: next.fetchedVia ?? existing.fetchedVia,
    bulletPoints: next.bulletPoints.length ? next.bulletPoints : existing.bulletPoints,
    detailStatus: preferNext ? next.detailStatus : existing.detailStatus,
  };
}

function deriveResearchInsights(run: ResearchRun): InsightItem[] {
  const priceValues = run.samples
    .map((sample) => parsePriceValue(sample.price))
    .filter((value): value is number => value != null);
  const reviewValues = run.samples
    .map((sample) => parseReviewValue(sample.reviews))
    .filter((value): value is number => value != null);
  const avgDemand = averageScore(run.candidates.map((candidate) => candidate.score_demand));
  const avgCompetition = averageScore(run.candidates.map((candidate) => candidate.score_competition));

  const demandTone: InsightItem['tone'] =
    run.sampleCount >= 8 || avgDemand >= 75 ? 'green' : run.sampleCount >= 3 ? 'blue' : 'amber';
  const demandValue =
    run.sampleCount >= 8
      ? '需求有真实样品支撑'
      : run.sampleCount >= 3
      ? '需求需要继续扩样'
      : '样品不足，谨慎判断';

  const maxReviews = reviewValues.length ? Math.max(...reviewValues) : null;
  const medianReviews = reviewValues.length ? median(reviewValues) : null;
  const competitionValue =
    avgCompetition >= 75
      ? '竞争空间相对可切入'
      : avgCompetition >= 55
      ? '竞争中等，必须做差异化'
      : '竞争偏高，避免直接跟同款';
  const competitionDetail = reviewValues.length
    ? `样品 review 中位数约 ${Math.round(medianReviews ?? 0)}，最高约 ${Math.round(maxReviews ?? 0)}；分数越高代表越不拥挤。`
    : '本次没有稳定抓到 review 数，先根据候选评分和样品数量做保守判断。';

  const priceValue = priceValues.length
    ? formatDollarRange(Math.min(...priceValues), Math.max(...priceValues))
    : run.priceBand || '待确认';
  const imageCount = run.samples.filter((sample) => sample.imageUrl).length;

  return [
    {
      title: '搜索需求',
      value: demandValue,
      detail: `本次保存 ${run.sampleCount} 个原始样品，${run.detailCount} 个已打开详情；候选平均需求分 ${avgDemand || '待评分'}。`,
      tone: demandTone,
    },
    {
      title: '竞争强度',
      value: competitionValue,
      detail: competitionDetail,
      tone: avgCompetition >= 70 ? 'green' : avgCompetition >= 50 ? 'amber' : 'amber',
    },
    {
      title: '价格带',
      value: priceValue,
      detail: priceValues.length
        ? '价格来自原始样品池，用于校准候选售价；正式立项前仍需结合成本表测毛利。'
        : '本次价格字段不足，后续需要补平台样品或手工价格带。',
      tone: 'blue',
    },
    {
      title: '痛点来源',
      value: run.detailCount > 0 ? '来自标题/详情推断' : '评论未抓取',
      detail:
        '手册要求读取买家评价；当前第一版还没有评论抓取，所以痛点不能伪装成真实评论结论。',
      tone: 'neutral',
    },
    {
      title: '视觉依据',
      value: imageCount > 0 ? `已保存 ${imageCount} 张商品图` : '旧数据缺少商品图',
      detail: imageCount > 0
        ? '候选差异化应对照竞品主图、包装图和细节图来做。'
        : '重新研究后会显示商品图，旧研究只能看标题和链接。',
      tone: imageCount > 0 ? 'green' : 'amber',
    },
    {
      title: '立项口径',
      value: '先 A/B/C 决策，再进工坊',
      detail: 'A 立即立项；B 排期但先补验证；C 暂不考虑。不要只看推荐分。',
      tone: 'neutral',
    },
  ];
}

function buildDecisionGrade(candidate: DiscoverCandidate): DecisionGrade {
  const score = candidate.score_total ?? 0;
  const profitWeak = (candidate.score_profit ?? 100) < 55;
  const competitionWeak = (candidate.score_competition ?? 100) < 50;
  if (score >= 78 && !profitWeak && !competitionWeak) {
    return {
      grade: 'A',
      label: '立即立项',
      summary: '市场、利润和执行条件相对均衡，可以进入小批量打样或上新准备。',
      nextAction: '找供应商并补成本表，确认后转入工坊制作主图和 Listing。',
      className:
        'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    };
  }
  if (score >= 60 && !profitWeak) {
    return {
      grade: 'B',
      label: '先验证',
      summary: '方向可进入备选池，但还需要补供应链、图文或成本验证。',
      nextAction: '先验证竞品痛点、供应商成本、包装和履约，再决定是否排期。',
      className:
        'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900',
    };
  }
  return {
    grade: 'C',
    label: '暂不考虑',
    summary: '当前竞争、利润或落地风险不足以支撑立项。',
    nextAction: '保留研究记录，换更窄关键词或补样品后重新研究。',
    className:
      'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900',
  };
}

function pickSupportSamples(
  candidate: DiscoverCandidate,
  samples: ResearchSample[],
): ResearchSample[] {
  if (samples.length === 0) return [];
  const haystack = [
    candidate.product_name,
    candidate.summary,
    candidate.differentiation,
    candidate.keyword,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const scored = samples.map((sample) => {
    const words = sample.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4);
    const hits = words.filter((word) => haystack.includes(word)).length;
    const detailBonus = sample.detailStatus === '详情页已打开' ? 2 : 0;
    return { sample, score: hits + detailBonus };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.sample);
}

function buildDifferentiationSections(
  candidate: DiscoverCandidate,
  samples: ResearchSample[],
  points: string[],
  risks: string[],
): {
  competitorProblem: string;
  proposedChange: string;
  whyItMaySell: string;
  validation: string;
} {
  const firstSample = samples[0];
  const rawDiff = candidate.differentiation?.trim() ?? '';
  const usableDiff = rawDiff && !looksMostlyEnglish(rawDiff) ? rawDiff : '';
  return {
    competitorProblem: firstSample
      ? `对标「${truncateText(firstSample.title, 42)}」等样品：先检查低价同质化、礼品感不足、定制弱或材质说明不清的问题。`
      : '本条旧数据缺少原始竞品；需要重新研究后才能把问题锚定到具体商品。',
    proposedChange:
      usableDiff ||
      points[0] ||
      '从定制项、材质规格、礼盒包装、主图风格和情绪化命名里选择一个明确改法。',
    whyItMaySell:
      candidate.summary && !looksMostlyEnglish(candidate.summary)
        ? candidate.summary
        : points[1] || '如果搜索样品证明已有成交需求，差异化包装和更明确场景能提升点击与转化。',
    validation:
      risks[0] ||
      '先确认采购/制作成本、定制时效、退换货规则、平台合规和首批广告预算。',
  };
}

function inferTargetAndScene(candidate: DiscoverCandidate, points: string[]): string {
  const text = [candidate.product_name, candidate.category, candidate.summary, points.join('；')]
    .filter(Boolean)
    .join(' ');
  const scenes: string[] = [];
  if (/婚|wedding|bridal/i.test(text)) scenes.push('婚礼/纪念日');
  if (/gift|礼|母亲节|父亲节|生日|anniversary/i.test(text)) scenes.push('送礼');
  if (/travel|portable|便携|通勤|daily|日常/i.test(text)) scenes.push('日常使用');
  if (/pet|dog|cat|宠物/i.test(text)) scenes.push('宠物主人');
  if (/kid|child|baby|儿童|婴儿/i.test(text)) scenes.push('亲子/儿童场景');
  const sceneText = scenes.length ? uniqueStrings(scenes).join('、') : '待从样品和评论继续验证';
  return `面向搜索「${candidate.keyword}」的买家，优先验证 ${sceneText}。`;
}

function inferSpecSuggestion(candidate: DiscoverCandidate, points: string[]): string {
  const pointText = points.slice(0, 2).filter((point) => !looksMostlyEnglish(point)).join('；');
  if (pointText) return `${pointText}；同时补齐材质、尺寸、颜色、包装和定制项。`;
  return `围绕「${candidate.product_name}」补材质、尺寸、颜色、包装、定制项和履约周期。`;
}

function inferVisualDirection(samples: ResearchSample[]): string {
  const hasImages = samples.some((sample) => sample.imageUrl);
  if (hasImages) {
    return '对照竞品主图做差异化：补场景图、细节图、包装图和可定制效果图，避免只换背景。';
  }
  return '旧数据没有商品图；重新研究后先看竞品主图风格，再决定拍摄和生成方向。';
}

function buildListingKeywords(
  candidate: DiscoverCandidate,
  samples: ResearchSample[],
): string[] {
  const stopWords = new Set([
    'with',
    'from',
    'for',
    'and',
    'the',
    'your',
    'this',
    'that',
    'pack',
    'pcs',
    'set',
  ]);
  const words = samples
    .flatMap((sample) => sample.title.toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 4 && !stopWords.has(word));
  const unique = uniqueStrings(words).slice(0, 7);
  if (unique.length > 0) return unique;
  if (/[a-z]/i.test(candidate.keyword)) return [candidate.keyword];
  return ['待从竞品标题提取'];
}

function inferResearchStatus(candidates: DiscoverCandidate[]): ResearchRun['status'] {
  if (candidates.some((candidate) => candidate.status === 'researching')) return '研究中';
  if (candidates.some((candidate) => candidate.status === 'ready' || candidate.status === 'promoted')) {
    return '已完成';
  }
  return '失败';
}

function parsePlatformFocus(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // fall through to comma parsing
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function strategyLabel(strategy?: string | null): string {
  const option = STRATEGY_OPTIONS.find((item) => item.id === strategy);
  return option?.label ?? strategy ?? '选品';
}

function uniqueFailures(items: Array<{ source: string; reason: string }>): Array<{ source: string; reason: string }> {
  const seen = new Set<string>();
  const out: Array<{ source: string; reason: string }> = [];
  for (const item of items) {
    const key = `${item.source}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function cleanEvidenceText(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = text
    .toLowerCase()
    .replace(/[。.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'null' ||
    normalized === 'undefined' ||
    normalized === 'unknown' ||
    normalized.startsWith('not visible') ||
    normalized.startsWith('not provided') ||
    normalized.startsWith('not available') ||
    normalized.startsWith('not found') ||
    normalized.includes('in provided html')
  ) {
    return null;
  }
  return text;
}

function cleanEvidenceList(items: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items ?? []) {
    const text = cleanEvidenceText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function parseNullableNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function averageScore(values: Array<number | null | undefined>): number {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numeric.length === 0) return 0;
  return Math.round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parsePriceValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseReviewValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '').trim().toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)(k|m)?/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2] === 'm') return base * 1_000_000;
  if (match[2] === 'k') return base * 1_000;
  return base;
}

function formatDollarRange(min: number, max: number): string {
  if (Math.abs(min - max) < 0.01) return `$${roundPrice(min)}`;
  return `$${roundPrice(min)}-${roundPrice(max)}`;
}

function roundPrice(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(value % 1 === 0 ? 0 : 2);
}

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '时间未知';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function minDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((min, value) => (dateValue(value) < dateValue(min) ? value : min));
}

function maxDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((max, value) => (dateValue(value) > dateValue(max) ? value : max));
}

function dateValue(raw: string | null | undefined): number {
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function looksMostlyEnglish(text: string): boolean {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinChars = text.match(/[a-z]/gi)?.length ?? 0;
  return chineseChars < 4 && latinChars > 24;
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function compactReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').trim();
}

function platformLabel(source?: string): string {
  switch (source) {
    case 'amazon':
      return 'Amazon';
    case 'amazon-us':
      return 'Amazon US';
    case 'amazon-uk':
      return 'Amazon UK';
    case 'amazon-jp':
      return 'Amazon JP';
    case 'amazon-de':
      return 'Amazon DE';
    case 'tiktok-shop-us':
      return 'TikTok Shop US';
    case 'tiktok-shop':
      return 'TikTok Shop';
    case 'etsy':
      return 'Etsy';
    case 'walmart':
      return 'Walmart';
    case 'shopify-dtc':
      return 'Shopify 独立站';
    case 'shopee':
    case 'shopee-sg':
      return 'Shopee';
    case 'lazada':
    case 'lazada-sg':
      return 'Lazada';
    default:
      return source || '目标平台';
  }
}

function parseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function CompareDialog({
  open,
  loading,
  result,
  error,
  candidatesById,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  result: CompareResult | null;
  error: string | null;
  candidatesById: Record<string, DiscoverCandidate>;
  onClose: () => void;
}): React.ReactElement {
  const VERDICT_TONE: Record<string, string> = {
    recommended: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
    'second-pick': 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
    avoid: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
    situational: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="size-4" /> AI 对比与推荐
          </DialogTitle>
          <DialogDescription>
            基于五维评分（按你的权重）+ 差异化 / 风险 / 卖点的综合判断。AI 也会给「下一步该怎么验证」。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> AI 分析中…
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : result ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <Award className="size-4" />
                AI 推荐：{candidatesById[result.recommended_id]?.product_name ?? result.recommended_id}
              </div>
              <p className="mt-2 text-xs text-foreground/80">{result.summary}</p>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">候选评估</h4>
              <ul className="space-y-2">
                {result.notes.map((n) => {
                  const cand = candidatesById[n.id];
                  if (!cand) return null;
                  const w = result.weighted.find((x) => x.id === n.id)?.weightedScore;
                  return (
                    <li
                      key={n.id}
                      className={`rounded-md border p-3 ${
                        n.id === result.recommended_id ? 'ring-1 ring-emerald-500' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{cand.product_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {cand.category}
                            {w != null ? ` · 加权分 ${w}` : ''}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] ring-1 ${
                            VERDICT_TONE[n.verdict] ?? VERDICT_TONE.situational
                          }`}
                        >
                          {n.verdict}
                        </span>
                      </div>
                      <p className="mt-2 text-[12px] text-foreground/80">{n.reason}</p>
                    </li>
                  );
                })}
              </ul>
            </div>

            {result.next_actions.length > 0 ? (
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                  下一步验证（AI 建议）
                </h4>
                <ul className="space-y-1 text-[12px]">
                  {result.next_actions.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
