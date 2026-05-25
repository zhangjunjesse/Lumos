'use client';

import * as React from 'react';
import { ChevronLeft, Pencil, Play, Power, Send, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

import type { RadarKind } from '../NewTaskDialog';
import type { RadarTaskRow } from '../types';
import {
  AlertCard, DigestCardItem, EvidenceItem, ReportCard, RunHistoryItem, StatsCardItem,
  type ProductRow, type RunHistoryRow as DetailRunHistoryRow, type TweetEvidenceRow,
} from './detail-cards';

const KIND_LABEL: Record<RadarKind, string> = { monitor: '监控雷达', topic: '选题挖掘', digest: '关注摘要', stats: '数据拆解' };
const KIND_COLLECTION: Record<RadarKind, string> = { monitor: 'radar_alerts', topic: 'topic_reports', digest: 'follow_digests', stats: 'stats_reports' };
const KIND_PRODUCT_LABEL: Record<RadarKind, string> = { monitor: '告警', topic: '选题报告', digest: '简报', stats: '数据报告' };

interface EvidenceRefRow {
  id: string;
  task_ref?: string;
  tweet_id?: string;
  matched_at?: string;
  kind?: string;
}

type RunHistoryRow = DetailRunHistoryRow;

interface TaskDetailTabProps {
  task: RadarTaskRow;
  onBack: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onToggleIm: () => void;
  onEdit: () => void;
  running: boolean;
  runMessage: { ok: boolean; text: string } | null;
}

export function TaskDetailTab({ task, onBack, onRun, onToggle, onDelete, onToggleIm, onEdit, running, runMessage }: TaskDetailTabProps): React.ReactElement {
  const [products, setProducts] = React.useState<ProductRow[]>([]);
  const [evidence, setEvidence] = React.useState<TweetEvidenceRow[]>([]);
  const [evidenceMatchedAt, setEvidenceMatchedAt] = React.useState<Map<string, string>>(new Map());
  const [history, setHistory] = React.useState<RunHistoryRow[]>([]);
  const [loadingProducts, setLoadingProducts] = React.useState(false);

  const loadProducts = React.useCallback(async () => {
    if (!task.kind) return;
    setLoadingProducts(true);
    try {
      const [productRes, refsRes, historyRes] = await Promise.all([
        fetch(`/api/apps/x-radar/data?collection=${KIND_COLLECTION[task.kind]}&limit=200`, { cache: 'no-store' }),
        fetch(`/api/apps/x-radar/data?collection=task_evidence_refs&limit=2000`, { cache: 'no-store' }),
        fetch(`/api/apps/x-radar/data?collection=run_history&limit=500`, { cache: 'no-store' }),
      ]);
      const productData = (await productRes.json()) as { rows?: ProductRow[] };
      setProducts((productData.rows ?? []).filter((r) => r.task_ref === task.id));

      const refsData = (await refsRes.json()) as { rows?: EvidenceRefRow[] };
      const myRefs = (refsData.rows ?? []).filter((r) => r.task_ref === task.id);
      // 同一推文可能被多次抓 (多次跑) — 只保留 matched_at 最新的一条
      const latestByTweet = new Map<string, string>();
      for (const ref of myRefs) {
        if (!ref.tweet_id) continue;
        const prev = latestByTweet.get(ref.tweet_id);
        if (!prev || (ref.matched_at && ref.matched_at > prev)) {
          latestByTweet.set(ref.tweet_id, ref.matched_at ?? '');
        }
      }
      setEvidenceMatchedAt(latestByTweet);
      const tweetIds = new Set(latestByTweet.keys());
      if (tweetIds.size === 0) { setEvidence([]); return; }
      const evRes = await fetch('/api/apps/x-radar/data?collection=tweet_evidence&limit=5000', { cache: 'no-store' });
      const evData = (await evRes.json()) as { rows?: TweetEvidenceRow[] };
      const mine = (evData.rows ?? []).filter((e) => tweetIds.has(e.id));
      mine.sort((a, b) => (latestByTweet.get(b.id) ?? '').localeCompare(latestByTweet.get(a.id) ?? ''));
      setEvidence(mine);

      const historyData = (await historyRes.json()) as { rows?: RunHistoryRow[] };
      const myHistory = (historyData.rows ?? [])
        .filter((r) => r.task_ref === task.id)
        .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
      setHistory(myHistory);
    } finally {
      setLoadingProducts(false);
    }
  }, [task.id, task.kind]);

  React.useEffect(() => { void loadProducts(); }, [loadProducts]);

  const config = parseConfig(task.config_json);
  const kind = task.kind ?? 'monitor';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ChevronLeft className="size-4 mr-0.5" /> 返回 {KIND_LABEL[kind]}
        </Button>
        <div className="flex items-center gap-2">
          <Button onClick={onRun} disabled={running}>
            <Play className={`size-4 mr-1 ${running ? 'animate-pulse' : ''}`} />
            {running ? '运行中…' : '立即跑一次'}
          </Button>
          <Button variant="ghost" onClick={onEdit}>
            <Pencil className="size-4 mr-1" />
            编辑
          </Button>
          <Button variant="ghost" onClick={onToggle}>
            <Power className="size-4 mr-1" />
            {task.enabled ? '禁用' : '启用'}
          </Button>
          <Button variant="ghost" onClick={onToggleIm}>
            <Send className="size-4 mr-1" />
            {task.im_enabled ? '关 IM' : '开 IM'}
          </Button>
          <Button variant="ghost" onClick={onDelete} className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">
            <Trash2 className="size-4 mr-1" />删除
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">{task.name || '未命名'}</h2>
        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <Badge variant="secondary">{KIND_LABEL[kind]}</Badge>
          <span>· {task.cadence ?? 'manual'}</span>
          {task.enabled === false && <Badge variant="outline">已禁用</Badge>}
          {task.im_enabled && <Badge variant="outline">推 IM → {task.im_target_label || '默认微信'}</Badge>}
        </div>
      </div>

      {runMessage && (
        <Alert variant={runMessage.ok ? 'default' : 'destructive'}>
          <AlertDescription className="text-sm">{runMessage.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">任务规则</CardTitle></CardHeader>
          <CardContent>
            {config ? <ConfigDisplay kind={kind} config={config} /> : (
              <p className="text-xs text-muted-foreground italic">config_json 解析失败 — 请删了重建</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">最近运行</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="状态" value={task.last_status ?? 'idle'} />
            <Row label="上次开始" value={task.last_run_started_at ? new Date(task.last_run_started_at).toLocaleString('zh-CN') : '尚未运行'} />
            <Row
              label="下次运行"
              value={task.next_run_at && task.enabled !== false && task.cadence !== 'manual'
                ? new Date(task.next_run_at).toLocaleString('zh-CN')
                : task.cadence === 'manual' ? '手动触发' : task.enabled === false ? '已禁用' : '—'}
            />
            {task.last_summary && <Row label="结果" value={task.last_summary} />}
            {task.last_failure_reason && <Row label="失败" value={task.last_failure_reason} valueClass="text-red-600" />}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          运行历史
          <span className="ml-2 text-sm text-muted-foreground tabular-nums">{history.length} 次</span>
        </h3>
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没运行过。
          </div>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {history.slice(0, 20).map((h) => (
              <RunHistoryItem key={h.id} row={h} />
            ))}
            {history.length > 20 && (
              <div className="px-4 py-2 text-xs text-muted-foreground text-center">
                仅显示最近 20 次（共 {history.length} 次）
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">
            抓取明细
            <span className="ml-2 text-sm text-muted-foreground tabular-nums">{evidence.length} 条原推</span>
          </h3>
        </div>
        {evidence.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没抓到过原推。跑一次任务后这里会显示每条抓到的推文。
          </div>
        ) : (
          <details className="rounded-lg border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-muted/40">
              展开 {evidence.length} 条原推
            </summary>
            <div className="border-t divide-y">
              {evidence.map((e) => <EvidenceItem key={e.id} row={e} matchedAt={evidenceMatchedAt.get(e.id)} />)}
            </div>
          </details>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">
            {KIND_PRODUCT_LABEL[kind]}
            <span className="ml-2 text-sm text-muted-foreground tabular-nums">{products.length} 条</span>
          </h3>
          {loadingProducts && <span className="text-xs text-muted-foreground">加载中…</span>}
        </div>
        {products.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            还没有产物。点上面「立即跑一次」试试。
          </div>
        ) : (
          <div className="space-y-3">
            {kind === 'monitor' && products.map((p) => <AlertCard key={p.id} row={p} />)}
            {kind === 'topic' && products.map((p) => <ReportCard key={p.id} row={p} />)}
            {kind === 'digest' && products.map((p) => <DigestCardItem key={p.id} row={p} />)}
            {kind === 'stats' && products.map((p) => <StatsCardItem key={p.id} row={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

function parseConfig(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

function ConfigDisplay({ kind, config }: { kind: RadarKind; config: Record<string, unknown> }): React.ReactElement {
  const entries = Object.entries(config).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && v.length === 0));
  return (
    <div className="space-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[120px_1fr] items-baseline gap-2">
          <span className="text-xs text-muted-foreground truncate">{CONFIG_LABEL[k] ?? k}</span>
          <span className="text-sm break-all">{Array.isArray(v) ? v.join('、') : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

const CONFIG_LABEL: Record<string, string> = {
  keywords: '关键词', from_handles: '来自 @', exclude_keywords: '排除词',
  window_hours: '时间窗（小时）', min_like: '最低点赞', min_retweet: '最低转推',
  search_mode: '搜索模式', topic: '主题', queries: '查询关键词',
  max_fetch: '抓取上限', thread_extract_count: 'thread 抽取条数',
  handles: '关注的 @', window_kind: '摘要窗口', per_handle_count: '每人推数',
  target_kind: '目标类型', target: '目标', sample_days: '采样天数',
  top_threads_count: 'top thread 数',
};
