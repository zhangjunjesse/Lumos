'use client';

import * as React from 'react';
import {
  ArrowRight,
  Brain,
  Compass,
  FileText,
  ImageIcon,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { BriefEditDialog } from './BriefEditDialog';

import type { PipelineEntry, PipelineStage } from './types';

interface PipelineSectionProps {
  entries: PipelineEntry[];
  loading: boolean;
  onJump: (target: 'studio' | 'jobs' | 'listings' | 'discover' | 'library') => void;
  onChanged?: () => void;
  onOpenDetail?: (entry: PipelineEntry) => void;
}

export function ProductPipelineSection({
  entries,
  loading,
  onJump,
  onChanged,
  onOpenDetail,
}: PipelineSectionProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">产品流水线</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            还没有产品。从「选品」抓候选转入，或在工坊「记录新商品输入」开始。
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {entries.map((e) => (
              <PipelineCard
                key={e.inputId}
                entry={e}
                onJump={onJump}
                onChanged={onChanged}
                onOpenDetail={onOpenDetail}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  'needs-main-image': '缺主图',
  'ready-to-generate': '待出图',
  'generating': '出图中',
  'image-failed': '出图失败',
  'has-final-image': '主图就绪',
  'listings-drafted': '已起 listing',
  'has-warnings': '含合规警示',
  'live-ready': '可上架',
};

const STAGE_TONE: Record<PipelineStage, string> = {
  'needs-main-image': 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  'ready-to-generate': 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
  'generating': 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
  'image-failed': 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
  'has-final-image': 'bg-foreground/5 text-foreground ring-border',
  'listings-drafted': 'bg-foreground/5 text-foreground ring-border',
  'has-warnings': 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  'live-ready': 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
};

const STEPS = [
  { key: 'main', label: '主图', icon: ImageIcon },
  { key: 'brief', label: 'Brief', icon: Sparkles },
  { key: 'final', label: '终版', icon: Wand2 },
  { key: 'listing', label: 'Listing', icon: FileText },
] as const;

function PipelineCard({
  entry,
  onJump,
  onChanged,
  onOpenDetail,
}: {
  entry: PipelineEntry;
  onJump: PipelineSectionProps['onJump'];
  onChanged?: () => void;
  onOpenDetail?: (entry: PipelineEntry) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<'upload' | 'reidentify' | null>(null);
  const [briefEditOpen, setBriefEditOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const uploadReal = async (file: File) => {
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('main_image', file);
      const res = await fetch(
        `/api/apps/builtin/ecommerce/inputs/${entry.inputId}/main-image`,
        { method: 'POST', body: fd },
      );
      if (res.ok) onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const reidentifyBrief = async () => {
    setBusy('reidentify');
    try {
      const res = await fetch(
        `/api/apps/builtin/ecommerce/inputs/${entry.inputId}/identify-brief`,
        { method: 'POST' },
      );
      if (res.ok) onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const completed = {
    main: entry.hasMainImage,
    brief: entry.brief.hasBrief,
    final: !!entry.finalImagePath,
    listing: entry.listings.ready > 0,
  };
  const platforms = Object.entries(entry.listings.byPlatform);
  const tone = STAGE_TONE[entry.stage] ?? STAGE_TONE['has-final-image'];

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {onOpenDetail ? (
            <button
              type="button"
              onClick={() => onOpenDetail(entry)}
              className="block truncate text-left text-sm font-medium hover:underline"
              title="打开产品详情"
            >
              {entry.title}
            </button>
          ) : (
            <p className="truncate text-sm font-medium">{entry.title}</p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {entry.categoryHint ?? '未分类'}
            {' · '}
            {entry.source === 'discover-promoted' ? '来自选品' : '手工输入'}
            {entry.brief.productType ? ` · ${entry.brief.productType}` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] ring-1 ${tone}`}
        >
          {STAGE_LABEL[entry.stage]}
        </span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto">
        {STEPS.map((s, idx) => {
          const done = completed[s.key];
          const isLastDone = done && (idx + 1 >= STEPS.length || !completed[STEPS[idx + 1].key]);
          const Icon = s.icon;
          return (
            <React.Fragment key={s.key}>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] tabular-nums ring-1 ${
                  done
                    ? 'bg-foreground text-background ring-foreground'
                    : isLastDone
                    ? 'bg-foreground/10 text-foreground ring-foreground/30'
                    : 'bg-background text-muted-foreground ring-border'
                }`}
              >
                <Icon className="size-3" />
                {s.label}
              </span>
              {idx < STEPS.length - 1 ? (
                <span className="text-muted-foreground">→</span>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="出图任务" value={entry.jobs.total} sub={statusLabel(entry.jobs)} />
        <Stat
          label="Listing"
          value={entry.listings.total}
          sub={
            platforms.length > 0
              ? platforms.map(([p, n]) => `${shortPlatform(p)}×${n}`).join(' · ')
              : '—'
          }
        />
        <Stat
          label="终版图"
          value={entry.finalImagePath ? '✓' : '—'}
          sub={entry.brief.confidence != null ? `brief ${entry.brief.confidence}` : '无 brief'}
        />
      </div>

      {entry.listings.hasWarnings ? (
        <div className="inline-flex items-center gap-1 self-start rounded-md bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">
          <ShieldAlert className="size-3" />
          listing 含合规警示
        </div>
      ) : null}

      <p className="rounded-md bg-foreground/5 p-2 text-[11px] text-foreground/80">
        <span className="font-semibold">下一步：</span>
        {entry.nextStep}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {!entry.hasMainImage ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadReal(f);
                e.target.value = '';
              }}
            />
            <ActionButton
              onClick={() => fileRef.current?.click()}
              icon={busy === 'upload' ? Loader2 : Upload}
              spin={busy === 'upload'}
            >
              上传真实样品图
            </ActionButton>
            {entry.conceptImagePath ? (
              <span className="rounded-md bg-foreground/5 px-2 py-1 text-[11px] text-muted-foreground">
                AI 概念图仅供参考，需真实样品图后才能出图
              </span>
            ) : null}
          </>
        ) : null}
        {entry.hasMainImage && entry.jobs.total === 0 ? (
          <ActionButton onClick={() => onJump('studio')} icon={Wand2}>
            去工坊出图
          </ActionButton>
        ) : null}
        {entry.jobs.running > 0 ? (
          <ActionButton onClick={() => onJump('jobs')} icon={Loader2} spin>
            看进度
          </ActionButton>
        ) : null}
        {entry.jobs.failed > 0 && entry.jobs.succeeded === 0 ? (
          <ActionButton onClick={() => onJump('jobs')} icon={XCircle}>
            看失败
          </ActionButton>
        ) : null}
        {!!entry.finalImagePath ? (
          <ActionButton onClick={() => onJump('listings')} icon={FileText}>
            起 listing
          </ActionButton>
        ) : null}
        {entry.candidateId ? (
          <ActionButton onClick={() => onJump('discover')} icon={Compass}>
            源候选
          </ActionButton>
        ) : null}
        {entry.brief.hasBrief ? (
          <ActionButton onClick={() => setBriefEditOpen(true)} icon={Brain}>
            编辑 brief
            {entry.brief.confidence != null
              ? ` (${entry.brief.confidence}/9)`
              : ''}
          </ActionButton>
        ) : null}
        {entry.hasMainImage ? (
          <ActionButton
            onClick={reidentifyBrief}
            icon={busy === 'reidentify' ? Loader2 : RefreshCcw}
            spin={busy === 'reidentify'}
          >
            {entry.brief.hasBrief ? '重识别 brief' : '识别 brief'}
          </ActionButton>
        ) : null}
      </div>

      <BriefEditDialog
        open={briefEditOpen}
        inputId={entry.inputId}
        productTitle={entry.title}
        onClose={() => setBriefEditOpen(false)}
        onSaved={() => {
          setBriefEditOpen(false);
          onChanged?.();
        }}
      />
    </li>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  spin,
  children,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-foreground/5"
    >
      <Icon className={`size-3 ${spin ? 'animate-spin' : ''}`} />
      {children}
      <ArrowRight className="size-3 text-muted-foreground" />
    </button>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md bg-foreground/5 p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-medium tabular-nums">{value}</p>
      {sub ? <p className="truncate text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function statusLabel(jobs: PipelineEntry['jobs']): string {
  if (jobs.running > 0) return `${jobs.running} 跑中`;
  if (jobs.succeeded > 0) return `${jobs.succeeded} 成功`;
  if (jobs.failed > 0) return `${jobs.failed} 失败`;
  return '—';
}

function shortPlatform(p: string): string {
  return p
    .replace('amazon-', 'Amz')
    .replace('tiktok-shop-', 'TT')
    .replace('shopify-dtc', 'Shop')
    .replace('shopee-', 'Spe')
    .replace('lazada-', 'Lzd');
}
