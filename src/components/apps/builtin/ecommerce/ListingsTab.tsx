'use client';

import * as React from 'react';
import {
  AlertCircle,
  Archive,
  Award,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  GitCompare,
  Loader2,
  RefreshCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Undo2,
  X,
  XCircle,
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
import { Textarea } from '@/components/ui/textarea';

interface ListingCompareEvaluation {
  id: string;
  scoreSeo: number;
  scoreConversion: number;
  scoreCompliance: number;
  scoreTotal: number;
  verdict: 'recommended' | 'second-pick' | 'rewrite' | 'situational';
  strengths: string[];
  weaknesses: string[];
}

interface ListingCompareResult {
  recommended_id: string;
  summary: string;
  evaluations: ListingCompareEvaluation[];
  cross_cutting_issues: string[];
}

import type { ListingDraft, ListingPlatform, ProductInput } from './types';

const PLATFORMS: { id: ListingPlatform; label: string }[] = [
  { id: 'amazon-us', label: 'Amazon US' },
  { id: 'amazon-uk', label: 'Amazon UK' },
  { id: 'amazon-jp', label: 'Amazon JP' },
  { id: 'amazon-de', label: 'Amazon DE' },
  { id: 'tiktok-shop-us', label: 'TikTok Shop US' },
  { id: 'etsy', label: 'Etsy' },
  { id: 'shopify-dtc', label: 'Shopify 独立站' },
  { id: 'shopee-sg', label: 'Shopee SG' },
  { id: 'lazada-sg', label: 'Lazada SG' },
  { id: 'walmart', label: 'Walmart' },
];

const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
];

interface ListingsTabProps {
  inputs: ProductInput[];
  drafts: ListingDraft[];
  loading: boolean;
  onChanged: () => void;
}

const STATUS_FILTER_OPTIONS = [
  { id: 'active', label: '当前' },
  { id: 'live', label: '已上线' },
  { id: 'submitted', label: '已提交' },
  { id: 'rejected', label: '被拒' },
  { id: 'archived', label: '历史' },
  { id: 'all', label: '全部' },
] as const;

type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]['id'];

export function ListingsTab({
  inputs,
  drafts,
  loading,
  onChanged,
}: ListingsTabProps): React.ReactElement {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('active');
  const [selectedDraftIds, setSelectedDraftIds] = React.useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [comparing, setComparing] = React.useState(false);
  const [compareResult, setCompareResult] = React.useState<ListingCompareResult | null>(null);
  const [compareError, setCompareError] = React.useState<string | null>(null);

  const toggleSelect = (id: string, on: boolean) =>
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const clearSelection = () => setSelectedDraftIds(new Set());

  const runCompare = async () => {
    setComparing(true);
    setCompareOpen(true);
    setCompareError(null);
    setCompareResult(null);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/listings/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_ids: Array.from(selectedDraftIds) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCompareError((json as { error?: string }).error ?? `对比失败 (${res.status})`);
        return;
      }
      setCompareResult(json as ListingCompareResult);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
    } finally {
      setComparing(false);
    }
  };
  const [inputId, setInputId] = React.useState<string>('');
  const [platforms, setPlatforms] = React.useState<ListingPlatform[]>(['amazon-us']);
  const [languages, setLanguages] = React.useState<string[]>(['en']);
  const [submitting, setSubmitting] = React.useState(false);
  const [batchProgress, setBatchProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!inputId && inputs.length > 0) setInputId(inputs[0].id);
  }, [inputs, inputId]);

  const togglePlatform = (id: ListingPlatform) =>
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  const toggleLanguage = (id: string) =>
    setLanguages((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!inputId) {
      setError('请选一个商品输入。');
      return;
    }
    if (platforms.length === 0) {
      setError('至少选 1 个平台。');
      return;
    }
    if (languages.length === 0) {
      setError('至少选 1 种语言。');
      return;
    }
    const total = platforms.length * languages.length;
    setSubmitting(true);
    setBatchProgress({ done: 0, total });
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/listings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_id: inputId, platforms, languages }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        succeeded?: number;
        failed?: number;
        outcomes?: Array<{ platform: string; language: string; ok: boolean; error?: string }>;
      };
      if (!res.ok) {
        setError(json.error ?? `起草失败 (${res.status})`);
        return;
      }
      const failed = json.failed ?? 0;
      if (failed > 0) {
        const firstErr = json.outcomes?.find((o) => !o.ok);
        setError(
          `${json.succeeded}/${total} 起草成功；${failed} 失败。首个失败：${firstErr?.platform}/${firstErr?.language} → ${firstErr?.error ?? '?'}`,
        );
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      setBatchProgress(null);
    }
  };

  const inputsById = React.useMemo(
    () => Object.fromEntries(inputs.map((i) => [i.id, i])),
    [inputs],
  );

  const visibleDrafts = React.useMemo(() => {
    switch (statusFilter) {
      case 'all':
        return drafts;
      case 'archived':
        return drafts.filter((d) => d.status === 'archived');
      case 'live':
        return drafts.filter((d) => d.status === 'live');
      case 'submitted':
        return drafts.filter((d) => d.status === 'submitted');
      case 'rejected':
        return drafts.filter((d) => d.status === 'rejected');
      case 'active':
      default:
        return drafts.filter((d) => d.status !== 'archived');
    }
  }, [drafts, statusFilter]);

  const summary = React.useMemo(() => {
    const counts = {
      live: 0,
      submitted: 0,
      rejected: 0,
      ready: 0,
      total: drafts.filter((d) => d.status !== 'archived').length,
    };
    for (const d of drafts) {
      if (d.status === 'live') counts.live++;
      else if (d.status === 'submitted') counts.submitted++;
      else if (d.status === 'rejected') counts.rejected++;
      else if (d.status === 'ready') counts.ready++;
    }
    return counts;
  }, [drafts]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> 起草新 listing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <Label className="text-xs">商品输入</Label>
              <select
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                disabled={submitting || inputs.length === 0}
                className="mt-1 h-9 w-full truncate rounded-md border bg-background px-3 text-sm"
              >
                {inputs.length === 0 ? (
                  <option value="">没有商品输入，先去工坊或选品创建</option>
                ) : (
                  inputs.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title} {i.category_hint ? `· ${i.category_hint}` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <Label className="text-xs">
                平台 <span className="text-muted-foreground">（多选，单次最多 6 个）</span>
              </Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => {
                  const on = platforms.includes(p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      disabled={submitting}
                      className={`rounded-md px-2 py-1 text-[11px] ring-1 transition-colors ${
                        on
                          ? 'bg-foreground text-background ring-foreground'
                          : 'bg-background text-foreground ring-border hover:bg-foreground/5'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label className="text-xs">
                语言 <span className="text-muted-foreground">（多选，单次最多 4 种）</span>
              </Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {LANGUAGES.map((l) => {
                  const on = languages.includes(l.id);
                  return (
                    <button
                      type="button"
                      key={l.id}
                      onClick={() => toggleLanguage(l.id)}
                      disabled={submitting}
                      className={`rounded-md px-2 py-1 text-[11px] ring-1 transition-colors ${
                        on
                          ? 'bg-foreground text-background ring-foreground'
                          : 'bg-background text-foreground ring-border hover:bg-foreground/5'
                      }`}
                    >
                      {l.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-end justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                共 {platforms.length} 平台 × {languages.length} 语言 ={' '}
                <span className="font-semibold tabular-nums">
                  {platforms.length * languages.length}
                </span>{' '}
                条草稿
              </p>
              <Button type="submit" disabled={submitting || !inputId} className="h-9">
                {submitting ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    {batchProgress
                      ? `起草中 (${batchProgress.done}/${batchProgress.total})`
                      : '起草中'}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3" /> 批量起草
                  </>
                )}
              </Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            AI 仅生成草稿，不会自行发布到任何平台。涉及虚假认证 / 医疗声称 / 竞品名风险时
            warnings 必有提示。批量起草顺序执行（不并发）以遵守 LLM rate limit。
          </p>
          {error ? (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle />
              <AlertTitle>起草失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="flex items-center gap-3">
              已有草稿
              <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                共 {summary.total} ·{' '}
                <span className="text-emerald-600">{summary.live} live</span> ·{' '}
                <span className="text-violet-600">{summary.submitted} submitted</span> ·{' '}
                <span className="text-foreground">{summary.ready} ready</span>
                {summary.rejected > 0 ? (
                  <>
                    {' · '}
                    <span className="text-red-600">{summary.rejected} rejected</span>
                  </>
                ) : null}
              </span>
              {selectedDraftIds.size > 0 ? (
                <span className="text-[11px] font-normal text-muted-foreground">
                  已选 {selectedDraftIds.size}
                </span>
              ) : null}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {selectedDraftIds.size > 0 ? (
                <>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    清除选中
                  </Button>
                  <Button
                    size="sm"
                    disabled={selectedDraftIds.size < 2 || selectedDraftIds.size > 5 || comparing}
                    onClick={runCompare}
                    title={
                      selectedDraftIds.size < 2
                        ? '至少选 2 个'
                        : selectedDraftIds.size > 5
                        ? '最多 5 个'
                        : '让 AI 对比并推荐最佳版本'
                    }
                  >
                    {comparing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <GitCompare className="size-3" />
                    )}
                    AI 对比 ({selectedDraftIds.size})
                  </Button>
                </>
              ) : null}
              <BatchExportButton drafts={visibleDrafts} />
              <div className="flex items-center gap-1">
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatusFilter(s.id)}
                    className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ${
                      statusFilter === s.id
                        ? 'bg-foreground text-background ring-foreground'
                        : 'bg-background text-muted-foreground ring-border hover:bg-foreground/5'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && drafts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">加载中…</p>
          ) : visibleDrafts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {drafts.length === 0
                ? '还没有草稿。在上面选商品 + 平台 + 语言，开始起草。'
                : '当前筛选下没有草稿。试试切换到其他筛选。'}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {visibleDrafts.map((d) => (
                <DraftCard
                  key={d.id}
                  draft={d}
                  productTitle={inputsById[d.input_id]?.title ?? '(未知商品)'}
                  onChanged={onChanged}
                  selected={selectedDraftIds.has(d.id)}
                  onToggleSelect={(on) => toggleSelect(d.id, on)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ListingCompareDialog
        open={compareOpen}
        loading={comparing}
        result={compareResult}
        error={compareError}
        draftsById={Object.fromEntries(drafts.map((d) => [d.id, d]))}
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}

function DraftCard({
  draft,
  productTitle,
  onChanged,
  selected,
  onToggleSelect,
}: {
  draft: ListingDraft;
  productTitle: string;
  onChanged: () => void;
  selected?: boolean;
  onToggleSelect?: (on: boolean) => void;
}): React.ReactElement {
  const bullets = parseList<string>(draft.bullets);
  const keywords = parseList<string>(draft.search_keywords);
  const warnings = parseList<string>(draft.warnings);

  const drafting = draft.status === 'drafting';
  const failed = draft.status === 'failed';
  const archived = draft.status === 'archived';
  const submitted = draft.status === 'submitted';
  const live = draft.status === 'live';
  const rejected = draft.status === 'rejected';

  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState<
    'save' | 'regen' | 'archive' | 'submit' | 'live' | 'reject' | 'reset' | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draftEdit, setDraftEdit] = React.useState(() => ({
    title: draft.title ?? '',
    description: draft.description ?? '',
    bullets: bullets.join('\n'),
    keywords: keywords.join(' '),
  }));

  React.useEffect(() => {
    setDraftEdit({
      title: draft.title ?? '',
      description: draft.description ?? '',
      bullets: parseList<string>(draft.bullets).join('\n'),
      keywords: parseList<string>(draft.search_keywords).join(' '),
    });
  }, [draft.title, draft.description, draft.bullets, draft.search_keywords]);

  const save = async () => {
    setError(null);
    setBusy('save');
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/listings/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftEdit.title,
          description: draftEdit.description,
          bullets: draftEdit.bullets.split('\n').map((b) => b.trim()).filter(Boolean),
          search_keywords: draftEdit.keywords
            .split(/\s+/)
            .map((k) => k.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `保存失败 (${res.status})`);
        return;
      }
      setEditing(false);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const regen = async () => {
    setError(null);
    setBusy('regen');
    try {
      const res = await fetch(
        `/api/apps/builtin/ecommerce/listings/${draft.id}/regenerate`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `重起草失败 (${res.status})`);
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    setError(null);
    setBusy('archive');
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/listings/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'ready' : 'archived' }),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(null);
    }
  };

  const transitionStatus = async (
    next: 'submitted' | 'live' | 'rejected' | 'ready',
    extra: Record<string, unknown> = {},
    busyKey: 'submit' | 'live' | 'reject' | 'reset',
  ) => {
    setError(null);
    setBusy(busyKey);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/listings/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, ...extra }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `操作失败 (${res.status})`);
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const markSubmitted = () => transitionStatus('submitted', {}, 'submit');
  const markLive = () => {
    const url =
      window.prompt('粘贴上线后的平台 URL（可留空）：', draft.live_url ?? '') ?? null;
    if (url === null) return; // user cancelled
    void transitionStatus('live', { live_url: url.trim() || null }, 'live');
  };
  const markRejected = () => {
    const reason =
      window.prompt('平台拒绝原因（必填）：', draft.rejection_reason ?? '') ?? '';
    if (!reason.trim()) return;
    void transitionStatus('rejected', { rejection_reason: reason.trim() }, 'reject');
  };
  const resetToReady = () => transitionStatus('ready', {}, 'reset');

  const compareEligible = !drafting && !failed && !!draft.title;

  return (
    <li
      className={`rounded-lg border p-4 ${archived ? 'opacity-60' : ''} ${
        selected ? 'ring-2 ring-foreground' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {compareEligible && onToggleSelect ? (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onToggleSelect(e.target.checked)}
            className="mt-1 size-3.5 shrink-0 cursor-pointer"
            title="选中以加入对比"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{productTitle}</p>
          <p className="mt-0.5 text-xs">
            <span className="rounded-md bg-foreground/5 px-2 py-0.5 font-medium">
              {draft.platform}
            </span>
            <span className="ml-1 rounded-md bg-foreground/5 px-2 py-0.5 font-medium">
              {draft.language}
            </span>
            {archived ? (
              <span className="ml-1 rounded-md bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                已归档
              </span>
            ) : null}
          </p>
        </div>
        <StatusBadge draft={draft} />
      </div>

      {live && draft.live_url ? (
        <a
          href={draft.live_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline dark:text-emerald-400"
        >
          <ExternalLink className="size-3" />
          {draft.live_url}
        </a>
      ) : null}
      {live ? <FollowupChecklist draftId={draft.id} /> : null}
      {rejected && draft.rejection_reason ? (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-[11px] text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          <span className="font-semibold">被拒原因：</span>
          {draft.rejection_reason}
        </p>
      ) : null}

      {drafting ? (
        <p className="mt-3 text-xs text-muted-foreground">起草中…</p>
      ) : failed ? (
        <p className="mt-3 text-xs text-destructive">
          失败原因：{draft.failure_reason ?? '未知错误'}
        </p>
      ) : editing ? (
        <div className="mt-3 space-y-3">
          <div>
            <Label className="text-xs">标题</Label>
            <Input
              value={draftEdit.title}
              onChange={(e) => setDraftEdit((d) => ({ ...d, title: e.target.value }))}
              disabled={busy === 'save'}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Bullets（每行一条）</Label>
            <Textarea
              value={draftEdit.bullets}
              onChange={(e) => setDraftEdit((d) => ({ ...d, bullets: e.target.value }))}
              disabled={busy === 'save'}
              rows={5}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">描述</Label>
            <Textarea
              value={draftEdit.description}
              onChange={(e) => setDraftEdit((d) => ({ ...d, description: e.target.value }))}
              disabled={busy === 'save'}
              rows={5}
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">后台关键词（空格分隔）</Label>
            <Textarea
              value={draftEdit.keywords}
              onChange={(e) => setDraftEdit((d) => ({ ...d, keywords: e.target.value }))}
              disabled={busy === 'save'}
              rows={2}
              className="mt-1 font-mono text-xs"
            />
          </div>
        </div>
      ) : (
        <>
          <Section label="标题" value={draft.title}>
            <CopyButton text={draft.title ?? ''} />
          </Section>

          {bullets.length ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Bullets ({bullets.length})</Label>
                <CopyButton text={bullets.map((b) => `• ${b}`).join('\n')} />
              </div>
              <ul className="mt-1 space-y-1 text-[12px]">
                {bullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Section label="描述" value={draft.description} multiline>
            <CopyButton text={draft.description ?? ''} />
          </Section>

          {keywords.length ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">后台关键词 ({keywords.length})</Label>
                <CopyButton text={keywords.join(' ')} />
              </div>
              <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                {keywords.join(' ')}
              </p>
            </div>
          ) : null}

          {warnings.length ? (
            <Alert className="mt-3" variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle className="text-xs">合规警示（必读）</AlertTitle>
              <AlertDescription className="space-y-1 text-[12px]">
                {warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}

      {error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription className="text-[11px]">{error}</AlertDescription>
        </Alert>
      ) : null}

      {!drafting && !failed ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === 'save'}
                onClick={() => setEditing(false)}
              >
                <X className="size-3" /> 取消
              </Button>
              <Button size="sm" disabled={busy === 'save'} onClick={save}>
                {busy === 'save' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                保存
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={!!busy}
                onClick={archive}
                title={archived ? '还原为当前' : '归档'}
              >
                <Archive className="size-3" />
                {archived ? '还原' : '归档'}
              </Button>
              <ExportMenu draftId={draft.id} />
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={regen}
              >
                {busy === 'regen' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3" />
                )}
                重起草
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy || archived}
                onClick={() => setEditing(true)}
              >
                <Edit3 className="size-3" /> 编辑
              </Button>

              {/* lifecycle transitions */}
              {!archived && !live && !submitted && !rejected ? (
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={markSubmitted}
                  title="标记为已复制到平台"
                >
                  {busy === 'submit' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  已提交
                </Button>
              ) : null}
              {(submitted || rejected) ? (
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={markLive}
                  title="标记为平台已上线"
                >
                  {busy === 'live' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  已上线
                </Button>
              ) : null}
              {(submitted || live) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={markRejected}
                  title="标记为平台拒绝"
                >
                  {busy === 'reject' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <XCircle className="size-3" />
                  )}
                  被拒
                </Button>
              ) : null}
              {(submitted || live || rejected) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={resetToReady}
                  title="撤销生命周期标记，回到 ready"
                >
                  {busy === 'reset' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Undo2 className="size-3" />
                  )}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Section({
  label,
  value,
  multiline,
  children,
}: {
  label: string;
  value?: string | null;
  multiline?: boolean;
  children?: React.ReactNode;
}): React.ReactElement | null {
  if (!value) return null;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {children}
      </div>
      <p
        className={`mt-1 text-[12px] text-foreground/80 ${
          multiline ? 'whitespace-pre-wrap' : 'line-clamp-2'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — surface in console only
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
    >
      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
      {copied ? '已复制' : '复制'}
    </button>
  );
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

function ListingCompareDialog({
  open,
  loading,
  result,
  error,
  draftsById,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  result: ListingCompareResult | null;
  error: string | null;
  draftsById: Record<string, ListingDraft>;
  onClose: () => void;
}): React.ReactElement {
  const VERDICT_TONE: Record<string, string> = {
    recommended: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
    'second-pick': 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
    rewrite: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
    situational: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="size-4" /> Listing 对比与推荐
          </DialogTitle>
          <DialogDescription>
            从 SEO / 转化 / 合规三维度评估，给出可落地的强弱项 + AI 推荐最佳版本。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> AI 评估中…
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
                推荐：{draftsById[result.recommended_id]?.platform ?? '?'} ·{' '}
                {draftsById[result.recommended_id]?.language ?? '?'}
              </div>
              <p className="mt-2 text-xs text-foreground/80">{result.summary}</p>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                逐版本评估
              </h4>
              <ul className="space-y-2">
                {result.evaluations.map((e) => {
                  const d = draftsById[e.id];
                  if (!d) return null;
                  return (
                    <li
                      key={e.id}
                      className={`rounded-md border p-3 ${
                        e.id === result.recommended_id ? 'ring-1 ring-emerald-500' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {d.platform} · {d.language}
                          </p>
                          <p className="line-clamp-1 text-[11px] text-muted-foreground">
                            {d.title}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] ring-1 ${
                            VERDICT_TONE[e.verdict] ?? VERDICT_TONE.situational
                          }`}
                        >
                          {e.verdict}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] tabular-nums">
                        <ScorePill label="SEO" value={e.scoreSeo} />
                        <ScorePill label="转化" value={e.scoreConversion} />
                        <ScorePill label="合规" value={e.scoreCompliance} />
                        <ScorePill label="综合" value={e.scoreTotal} highlight />
                      </div>
                      {e.strengths.length > 0 ? (
                        <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                          <span className="font-semibold">+ 强项：</span>
                          {e.strengths.join('；')}
                        </p>
                      ) : null}
                      {e.weaknesses.length > 0 ? (
                        <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
                          <span className="font-semibold">− 弱项：</span>
                          {e.weaknesses.join('；')}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            {result.cross_cutting_issues.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                <h4 className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  共性问题（影响所有版本）
                </h4>
                <ul className="space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                  {result.cross_cutting_issues.map((s, i) => (
                    <li key={i}>• {s}</li>
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

interface FollowupItem {
  id: string;
  title: string;
  description?: string | null;
  due_at: string;
  status: 'pending' | 'done' | 'skipped';
}

function FollowupChecklist({ draftId }: { draftId: string }): React.ReactElement {
  const [items, setItems] = React.useState<FollowupItem[] | null>(null);
  const [updating, setUpdating] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/apps/builtin/ecommerce/listings/${draftId}/followups`,
      );
      if (!res.ok) {
        setItems([]);
        return;
      }
      const json = (await res.json()) as { followups?: FollowupItem[] };
      setItems(json.followups ?? []);
    } catch {
      setItems([]);
    }
  }, [draftId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: 'pending' | 'done' | 'skipped') => {
    setUpdating(id);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/followups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await load();
    } finally {
      setUpdating(null);
    }
  };

  if (!items) return <p className="mt-2 text-[11px] text-muted-foreground">加载售后清单…</p>;
  if (items.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        没有售后清单（标 live 后会自动生成 D+1/D+3/D+7 跟进项）。
      </p>
    );
  }

  const done = items.filter((i) => i.status === 'done' || i.status === 'skipped').length;
  return (
    <details className="mt-3 rounded-md border bg-foreground/5 p-2">
      <summary className="cursor-pointer text-[11px] font-medium">
        售后清单 {done}/{items.length}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => {
          const isDone = it.status === 'done';
          const isSkipped = it.status === 'skipped';
          return (
            <li key={it.id} className="flex items-start gap-2 rounded border bg-background p-2">
              <input
                type="checkbox"
                checked={isDone}
                disabled={updating === it.id}
                onChange={(e) => setStatus(it.id, e.target.checked ? 'done' : 'pending')}
                className="mt-0.5 size-3.5 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[11px] font-medium ${
                    isDone || isSkipped ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {it.title}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  到期 {formatDateShort(it.due_at)}
                </p>
                {!isDone && it.description ? (
                  <p className="mt-1 text-[10px] text-foreground/70">{it.description}</p>
                ) : null}
              </div>
              {!isDone && !isSkipped ? (
                <button
                  type="button"
                  onClick={() => setStatus(it.id, 'skipped')}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  disabled={updating === it.id}
                >
                  跳过
                </button>
              ) : isSkipped ? (
                <span className="text-[10px] text-muted-foreground">已跳过</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso.slice(5, 10);
  }
}

function ScorePill({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}): React.ReactElement {
  const tone = value >= 75 ? 'text-emerald-600' : value >= 50 ? 'text-foreground' : 'text-muted-foreground';
  return (
    <div
      className={`flex flex-col items-center gap-0.5 rounded-md py-1 ${
        highlight ? 'bg-foreground/10' : 'bg-foreground/5'
      }`}
    >
      <span className={`font-semibold ${tone}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function StatusBadge({ draft }: { draft: ListingDraft }): React.ReactElement {
  const cls =
    draft.status === 'live'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900'
      : draft.status === 'submitted'
        ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900'
        : draft.status === 'rejected'
          ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900'
          : draft.status === 'failed'
            ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900'
            : draft.status === 'archived'
              ? 'bg-muted text-muted-foreground ring-border'
              : draft.status === 'drafting'
                ? 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900'
                : 'bg-foreground/5 text-foreground ring-border';
  const label = STATUS_LABEL[draft.status];
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ring-1 ${cls}`}>
      {label}
    </span>
  );
}

const STATUS_LABEL: Record<ListingDraft['status'], string> = {
  drafting: '起草中',
  ready: '就绪',
  failed: '失败',
  archived: '历史',
  submitted: '已提交',
  live: '已上线',
  rejected: '被拒',
};

const EXPORT_FORMATS = [
  { id: 'csv', label: 'CSV' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON' },
  { id: 'amazon-loader', label: 'Amazon Loader (TSV)' },
] as const;

type ExportFormatId = (typeof EXPORT_FORMATS)[number]['id'];

function ExportMenu({ draftId }: { draftId: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        title="导出"
      >
        <Download className="size-3" />
        导出
      </Button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-md border bg-popover shadow-md">
          {EXPORT_FORMATS.map((f) => (
            <a
              key={f.id}
              href={`/api/apps/builtin/ecommerce/listings/${draftId}/export?format=${f.id}`}
              className="block px-3 py-2 text-xs hover:bg-foreground/5"
              onClick={() => setOpen(false)}
            >
              {f.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BatchExportButton({
  drafts,
}: {
  drafts: ListingDraft[];
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (drafts.length === 0) return null;

  const exportAll = async (format: ExportFormatId, bundle: 'merged' | 'zip') => {
    setBusy(true);
    setOpen(false);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/listings/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          bundle,
          ids: drafts.map((d) => d.id),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        alert(json.error ?? `导出失败 (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get('content-disposition') ?? '';
      const match = /filename="?([^";]+)"?/i.exec(dispo);
      const filename = match?.[1] ?? `listings.${format === 'amazon-loader' ? 'csv' : format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        批量导出 ({drafts.length})
      </Button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-md border bg-popover shadow-md">
          <div className="border-b bg-muted/30 px-3 py-1.5 text-[10px] font-medium uppercase text-muted-foreground">
            合并为 1 个文件
          </div>
          {EXPORT_FORMATS.map((f) => (
            <button
              key={`merged-${f.id}`}
              type="button"
              className="block w-full px-3 py-2 text-left text-xs hover:bg-foreground/5"
              onClick={() => exportAll(f.id, 'merged')}
            >
              {f.label}
            </button>
          ))}
          <div className="border-b border-t bg-muted/30 px-3 py-1.5 text-[10px] font-medium uppercase text-muted-foreground">
            每条一个文件 · 打包 ZIP
          </div>
          {EXPORT_FORMATS.map((f) => (
            <button
              key={`zip-${f.id}`}
              type="button"
              className="block w-full px-3 py-2 text-left text-xs hover:bg-foreground/5"
              onClick={() => exportAll(f.id, 'zip')}
            >
              {f.label} (zip)
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
