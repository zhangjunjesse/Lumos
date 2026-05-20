'use client';

import * as React from 'react';
import {
  ExternalLink,
  Image as ImageIcon,
  Package,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EhuntReviewPanel } from './EhuntReviewPanel';

import type {
  DiscoverCandidate,
  ImageJob,
  ImageOutput,
  ListingDraft,
  PipelineEntry,
  ProductInput,
} from './types';

type DetailTab = 'overview' | 'assets' | 'jobs' | 'listings' | 'source' | 'ehunt' | 'followups' | 'activity';

interface AuditEvent {
  id: string;
  kind: string;
  target_id: string;
  target_type: string;
  input_id?: string | null;
  payload?: string | null;
  summary?: string | null;
  occurred_at?: string | null;
}

interface FollowupItem {
  id: string;
  draft_id: string;
  template_id: string;
  title: string;
  description?: string | null;
  due_at: string;
  status: 'pending' | 'done' | 'skipped';
}

interface ProductDetailDialogProps {
  open: boolean;
  entry: PipelineEntry | null;
  input: ProductInput | null;
  outputs: ImageOutput[];
  jobs: ImageJob[];
  drafts: ListingDraft[];
  candidate: DiscoverCandidate | null;
  onClose: () => void;
}

export function ProductDetailDialog({
  open,
  entry,
  input,
  outputs,
  jobs,
  drafts,
  candidate,
  onClose,
}: ProductDetailDialogProps): React.ReactElement | null {
  const [tab, setTab] = React.useState<DetailTab>('overview');
  const [auditEvents, setAuditEvents] = React.useState<AuditEvent[] | null>(null);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [followups, setFollowups] = React.useState<FollowupItem[] | null>(null);
  const [followupLoading, setFollowupLoading] = React.useState(false);
  const [followupBusy, setFollowupBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTab('overview');
      setAuditEvents(null);
      setFollowups(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || tab !== 'activity' || !entry) return;
    let cancelled = false;
    setAuditLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/apps/builtin/ecommerce/audit-log?input_id=${encodeURIComponent(entry.inputId)}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setAuditEvents([]);
          return;
        }
        const json = (await res.json()) as { events?: AuditEvent[] };
        setAuditEvents(json.events ?? []);
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, entry]);

  const loadFollowups = React.useCallback(async () => {
    if (!entry) return;
    setFollowupLoading(true);
    try {
      // Fetch followups for each draft tied to this product, then concat.
      const draftIds = drafts.filter((d) => d.input_id === entry.inputId).map((d) => d.id);
      const all: FollowupItem[] = [];
      for (const draftId of draftIds) {
        const res = await fetch(
          `/api/apps/builtin/ecommerce/listings/${draftId}/followups`,
        );
        if (!res.ok) continue;
        const json = (await res.json()) as { followups?: FollowupItem[] };
        if (json.followups) all.push(...json.followups);
      }
      all.sort((a, b) => a.due_at.localeCompare(b.due_at));
      setFollowups(all);
    } finally {
      setFollowupLoading(false);
    }
  }, [drafts, entry]);

  React.useEffect(() => {
    if (!open || tab !== 'followups' || !entry) return;
    void loadFollowups();
  }, [open, tab, entry, loadFollowups]);

  const setFollowupStatus = async (id: string, status: 'pending' | 'done' | 'skipped') => {
    setFollowupBusy(id);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/followups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await loadFollowups();
    } finally {
      setFollowupBusy(null);
    }
  };

  if (!entry) return null;

  const productOutputs = outputs.filter((o) =>
    jobs.some((j) => j.id === o.job_id),
  );
  const productJobs = jobs.filter((j) => j.input_id === entry.inputId);
  const productDrafts = drafts.filter((d) => d.input_id === entry.inputId);

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4" />
            {entry.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap gap-2 text-[11px]">
            <span>{entry.categoryHint ?? '未分类'}</span>
            <span>·</span>
            <span>{entry.source === 'discover-promoted' ? '来自选品' : '手工录入'}</span>
            {entry.brief.productType ? (
              <>
                <span>·</span>
                <span>brief: {entry.brief.productType}</span>
              </>
            ) : null}
            {entry.brief.confidence != null ? (
              <>
                <span>·</span>
                <span>confidence {entry.brief.confidence}/9</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="assets">资产 ({productOutputs.length})</TabsTrigger>
            <TabsTrigger value="jobs">出图任务 ({productJobs.length})</TabsTrigger>
            <TabsTrigger value="listings">Listing ({productDrafts.length})</TabsTrigger>
            <TabsTrigger value="followups">售后</TabsTrigger>
            {candidate ? <TabsTrigger value="source">源候选</TabsTrigger> : null}
            {candidate ? <TabsTrigger value="ehunt">EHunt</TabsTrigger> : null}
            <TabsTrigger value="activity">活动</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-3">
            <Section title="主图">
              {entry.hasMainImage ? (
                <Thumbnail path={entry.mainImagePath} alt="main" />
              ) : (
                <p className="text-xs text-amber-700">缺主图。去工坊上传或用 AI 概念图占位。</p>
              )}
            </Section>
            {entry.conceptImagePath && entry.conceptImagePath !== entry.mainImagePath ? (
              <Section title="AI 概念图（来自选品）">
                <Thumbnail path={entry.conceptImagePath} alt="concept" />
              </Section>
            ) : null}
            {entry.finalImagePath ? (
              <Section title="终版图（出图 SOP 产物）">
                <Thumbnail path={entry.finalImagePath} alt="final" highlight />
              </Section>
            ) : null}
            <Section title="流水线状态">
              <p className="text-xs">
                <code className="rounded bg-muted px-1.5">{entry.stage}</code>
              </p>
              <p className="mt-1 rounded-md bg-foreground/5 p-2 text-[11px]">
                <span className="font-semibold">下一步：</span>
                {entry.nextStep}
              </p>
            </Section>
            {input?.note ? (
              <Section title="备注">
                <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">
                  {input.note}
                </pre>
              </Section>
            ) : null}
          </TabsContent>

          <TabsContent value="assets" className="mt-4 space-y-3">
            {productOutputs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                还没有出图产物。
              </p>
            ) : (
              <>
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  主图阶段
                </div>
                <AssetGroup label="抠图 (cutout)" outputs={productOutputs.filter((o) => o.kind === 'cutout')} />
                <AssetGroup label="catalog (主图风格)" outputs={productOutputs.filter((o) => o.kind === 'catalog')} />
                <AssetGroup label="lifestyle (生活场景)" outputs={productOutputs.filter((o) => o.kind === 'lifestyle')} />
                <AssetGroup label="campaign (高端)" outputs={productOutputs.filter((o) => o.kind === 'campaign')} />
                <AssetGroup label="终版 (final)" outputs={productOutputs.filter((o) => o.kind === 'final')} highlight />
                <AssetGroup label="兜底 (fallback)" outputs={productOutputs.filter((o) => o.kind === 'fallback')} />
                <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  详情图编排
                </div>
                <AssetGroup label="高端白底 (detail-hero)" outputs={productOutputs.filter((o) => o.kind === 'detail-hero')} />
                <AssetGroup label="卖点特写 (detail-feature)" outputs={productOutputs.filter((o) => o.kind === 'detail-feature')} />
                <AssetGroup label="使用场景 (detail-lifestyle)" outputs={productOutputs.filter((o) => o.kind === 'detail-lifestyle')} />
                <AssetGroup label="尺寸参照 (detail-scale)" outputs={productOutputs.filter((o) => o.kind === 'detail-scale')} />
              </>
            )}
          </TabsContent>

          <TabsContent value="jobs" className="mt-4 space-y-2">
            {productJobs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                还没有出图任务。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {productJobs
                  .slice()
                  .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
                  .map((j) => (
                    <li key={j.id} className="rounded border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span>
                          <code className="rounded bg-muted px-1">{j.status}</code>
                          {j.stage ? ` · ${j.stage}` : ''}
                          {typeof j.progress === 'number' ? ` · ${j.progress}%` : ''}
                          {j.winner_direction ? ` · ${j.winner_direction}` : ''}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {(j.created_at ?? '').slice(0, 16).replace('T', ' ')}
                        </span>
                      </div>
                      {j.failure_reason ? (
                        <p className="mt-1 text-[11px] text-destructive">
                          失败：{j.failure_reason}
                          {j.failure_stage ? `（${j.failure_stage}）` : ''}
                        </p>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="listings" className="mt-4 space-y-2">
            {productDrafts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                还没有 listing 草稿。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {productDrafts
                  .slice()
                  .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
                  .map((d) => (
                    <li key={d.id} className="rounded border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          <span className="rounded bg-muted px-1 text-[10px]">
                            {d.platform}
                          </span>{' '}
                          <span className="text-[10px] text-muted-foreground">
                            {d.language}
                          </span>{' '}
                          {d.title ?? '(未起草)'}
                        </span>
                        <span className={`shrink-0 text-[10px] ${statusColor(d.status)}`}>
                          {d.status}
                        </span>
                      </div>
                      {d.live_url ? (
                        <a
                          href={d.live_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:underline"
                        >
                          <ExternalLink className="size-2.5" />
                          {d.live_url}
                        </a>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="followups" className="mt-4">
            {followupLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
            ) : !followups || followups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                还没有售后清单。Listing 标记 「已上线」后会自动生成 D+1/D+3/D+7 跟进项。
              </p>
            ) : (
              <FollowupsView
                items={followups}
                drafts={productDrafts}
                onSetStatus={setFollowupStatus}
                busyId={followupBusy}
              />
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            {auditLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
            ) : !auditEvents || auditEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                还没有活动记录。所有 promote / 上传 / brief 编辑 / listing 操作都会写入这里。
              </p>
            ) : (
              <ol className="space-y-1 text-xs">
                {auditEvents.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline gap-2 border-b py-1.5 last:border-0"
                  >
                    <span className="w-24 shrink-0 text-[10px] text-muted-foreground">
                      {(e.occurred_at ?? '').slice(0, 16).replace('T', ' ')}
                    </span>
                    <span className="w-32 shrink-0 truncate rounded-md bg-foreground/5 px-1.5 py-0.5 text-center text-[10px] font-mono">
                      {e.kind}
                    </span>
                    <span className="flex-1 truncate" title={e.payload ?? undefined}>
                      {e.summary ?? `${e.target_type}#${e.target_id.slice(0, 8)}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>

          {candidate ? (
            <TabsContent value="source" className="mt-4 space-y-3">
              <Section title="候选信息">
                <p className="text-xs">
                  来自研究 <code className="rounded bg-muted px-1">{candidate.research_id.slice(0, 8)}</code>
                  {' · '}
                  关键词 {candidate.keyword} · 市场 {candidate.market}
                  {candidate.estimated_price_usd ? ` · 预估价 $${candidate.estimated_price_usd}` : ''}
                </p>
              </Section>
              {candidate.summary ? (
                <Section title="AI 摘要">
                  <p className="text-[11px]">{candidate.summary}</p>
                </Section>
              ) : null}
              {candidate.differentiation ? (
                <Section title="差异化">
                  <p className="rounded-md bg-foreground/5 p-2 text-[11px]">
                    {candidate.differentiation}
                  </p>
                </Section>
              ) : null}
              <ListSection title="卖点" raw={candidate.selling_points} />
              <ListSection title="风险" raw={candidate.risks} />
              <UrlListSection title="参考竞品" raw={candidate.reference_urls} />
              <UrlListSection title="货源搜索" raw={candidate.source_search_urls} />
              <SourcesAudit raw={candidate.sources} />
            </TabsContent>
          ) : null}

          {candidate ? (
            <TabsContent value="ehunt" className="mt-4">
              <EhuntReviewPanel candidate={candidate} />
            </TabsContent>
          ) : null}
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function Thumbnail({
  path,
  alt,
  highlight,
}: {
  path: string;
  alt: string;
  highlight?: boolean;
}): React.ReactElement {
  if (!path) {
    return (
      <div className="flex aspect-[4/5] w-32 items-center justify-center rounded bg-muted">
        <ImageIcon className="size-6 text-muted-foreground" />
      </div>
    );
  }
  const url = `/api/uploads?path=${encodeURIComponent(path)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`inline-block overflow-hidden rounded border ${
        highlight ? 'ring-2 ring-emerald-500' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="h-32 w-32 object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    </a>
  );
}

function AssetGroup({
  label,
  outputs,
  highlight,
}: {
  label: string;
  outputs: ImageOutput[];
  highlight?: boolean;
}): React.ReactElement | null {
  if (outputs.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
        {label} ({outputs.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {outputs.map((o) => (
          <Thumbnail key={o.id} path={o.image_path} alt={o.kind} highlight={highlight && o.is_winner === true} />
        ))}
      </div>
    </div>
  );
}

function ListSection({
  title,
  raw,
}: {
  title: string;
  raw: string | null | undefined;
}): React.ReactElement | null {
  const items = parseList<string>(raw);
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="ml-4 list-disc space-y-0.5 text-[11px]">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </Section>
  );
}

function UrlListSection({
  title,
  raw,
}: {
  title: string;
  raw: string | null | undefined;
}): React.ReactElement | null {
  const items = parseList<{ platform: string; url: string; label?: string }>(raw);
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="space-y-0.5 text-[11px]">
        {items.map((u, i) => (
          <li key={i}>
            <a
              href={u.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 hover:underline"
            >
              <ExternalLink className="size-2.5" />
              <span>
                {u.platform}
                {u.label ? ` · ${u.label}` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SourcesAudit({ raw }: { raw: string | null | undefined }): React.ReactElement | null {
  const items = parseList<{
    kind: string;
    source?: string;
    sample_count?: number;
    samples?: { title: string; price?: string | null; rating?: string | null; url?: string | null }[];
    details?: Array<{
      rank: number;
      title: string;
      url: string;
      price?: string | null;
      rating?: string | null;
      reviews?: string | null;
      brand?: string | null;
      availability?: string | null;
      bullet_points?: string[];
      description?: string | null;
      image_url?: string | null;
    }>;
    detail_warnings?: string[];
    note?: string;
    reason?: string;
    label?: string;
    weights?: Record<string, number>;
    rule?: string;
  }>(raw);
  if (items.length === 0) return null;
  return (
    <Section title="数据来源审计">
      <ul className="space-y-1.5 text-[11px]">
        {items.map((s, i) => (
          <li key={i} className="rounded border p-2">
            <p className="font-medium">{s.kind}{s.source ? ` · ${s.source}` : ''}</p>
            {s.sample_count != null ? (
              <p className="text-muted-foreground">真实样品 {s.sample_count} 条</p>
            ) : null}
            {s.kind === 'selection-strategy' ? (
              <p className="text-muted-foreground">
                {s.label ?? '选品策略'}
                {s.weights ? ` · 权重 需求 ${s.weights.demand} / 蓝海 ${s.weights.competition} / 利润 ${s.weights.profit} / 合规 ${s.weights.compliance} / 物流 ${s.weights.logistics}` : ''}
              </p>
            ) : null}
            {s.note ? <p className="text-muted-foreground">{s.note}</p> : null}
            {s.reason ? <p className="text-amber-700">失败原因：{s.reason}</p> : null}
            {s.samples && s.samples.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-muted-foreground">
                  展开样品（{s.samples.length}）
                </summary>
                <ul className="mt-1 space-y-0.5 text-[10px]">
                  {s.samples.map((sp, j) => (
                    <li key={j}>
                      {j + 1}. {sp.title}
                      {sp.price ? ` · ${sp.price}` : ''}
                      {sp.rating ? ` · ★${sp.rating}` : ''}
                      {sp.url ? ' · 可打开详情' : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {s.details && s.details.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-muted-foreground">
                  展开商品详情（{s.details.length}）
                </summary>
                <ul className="mt-1 space-y-1 text-[10px]">
                  {s.details.map((d) => (
                    <li key={`${d.url}-${d.rank}`} className="rounded bg-foreground/5 p-1.5">
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        <ExternalLink className="size-2.5" />
                        #{d.rank} {d.title}
                      </a>
                      <p className="mt-0.5 text-muted-foreground">
                        {[
                          d.price,
                          d.rating ? `★${d.rating}` : null,
                          d.reviews ? `${d.reviews} reviews` : null,
                          d.brand,
                          d.availability,
                        ].filter(Boolean).join(' · ')}
                      </p>
                      {d.bullet_points?.length ? (
                        <ul className="ml-4 mt-1 list-disc space-y-0.5">
                          {d.bullet_points.slice(0, 3).map((point, idx) => (
                            <li key={idx}>{point}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {s.detail_warnings && s.detail_warnings.length > 0 ? (
              <p className="mt-1 text-amber-700">
                详情抓取警告：{s.detail_warnings.join('；')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FollowupsView({
  items,
  drafts,
  onSetStatus,
  busyId,
}: {
  items: FollowupItem[];
  drafts: ListingDraft[];
  onSetStatus: (id: string, status: 'pending' | 'done' | 'skipped') => void | Promise<void>;
  busyId: string | null;
}): React.ReactElement {
  const draftLabel = (draftId: string) => {
    const d = drafts.find((x) => x.id === draftId);
    return d ? `${d.platform}/${d.language}` : draftId.slice(0, 8);
  };
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
  }, [items]);
  const effectiveNow = now ?? 0;
  const overdue = items.filter(
    (i) => i.status === 'pending' && new Date(i.due_at).getTime() < effectiveNow,
  );
  const upcoming = items.filter(
    (i) => i.status === 'pending' && new Date(i.due_at).getTime() >= effectiveNow,
  );
  const done = items.filter((i) => i.status !== 'pending');

  return (
    <div className="space-y-4">
      {overdue.length > 0 ? (
        <FollowupGroup
          label={`🔴 已逾期 (${overdue.length})`}
          items={overdue}
          draftLabel={draftLabel}
          onSetStatus={onSetStatus}
          busyId={busyId}
          tone="overdue"
        />
      ) : null}
      {upcoming.length > 0 ? (
        <FollowupGroup
          label={`⏳ 待处理 (${upcoming.length})`}
          items={upcoming}
          draftLabel={draftLabel}
          onSetStatus={onSetStatus}
          busyId={busyId}
          tone="upcoming"
        />
      ) : null}
      {done.length > 0 ? (
        <FollowupGroup
          label={`✓ 已完成 / 已跳过 (${done.length})`}
          items={done}
          draftLabel={draftLabel}
          onSetStatus={onSetStatus}
          busyId={busyId}
          tone="done"
        />
      ) : null}
    </div>
  );
}

function FollowupGroup({
  label,
  items,
  draftLabel,
  onSetStatus,
  busyId,
  tone,
}: {
  label: string;
  items: FollowupItem[];
  draftLabel: (draftId: string) => string;
  onSetStatus: (id: string, status: 'pending' | 'done' | 'skipped') => void | Promise<void>;
  busyId: string | null;
  tone: 'overdue' | 'upcoming' | 'done';
}): React.ReactElement {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{label}</p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            className={`rounded border p-2 ${
              tone === 'overdue'
                ? 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
                : tone === 'done'
                ? 'opacity-60'
                : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={it.status === 'done'}
                disabled={busyId === it.id || it.status === 'skipped'}
                onChange={(e) =>
                  void onSetStatus(it.id, e.target.checked ? 'done' : 'pending')
                }
                className="mt-0.5 size-3.5 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[11px] font-medium ${
                    it.status === 'done' || it.status === 'skipped'
                      ? 'line-through'
                      : ''
                  }`}
                >
                  {it.title}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {draftLabel(it.draft_id)} · 到期 {it.due_at.slice(0, 10)}
                </p>
                {it.description && it.status === 'pending' ? (
                  <p className="mt-1 text-[10px] text-foreground/70">{it.description}</p>
                ) : null}
              </div>
              {it.status === 'pending' ? (
                <button
                  type="button"
                  onClick={() => void onSetStatus(it.id, 'skipped')}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  disabled={busyId === it.id}
                >
                  跳过
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'live': return 'text-emerald-600';
    case 'submitted': return 'text-violet-600';
    case 'rejected': return 'text-red-600';
    case 'failed': return 'text-red-600';
    case 'archived': return 'text-muted-foreground';
    default: return 'text-foreground';
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
