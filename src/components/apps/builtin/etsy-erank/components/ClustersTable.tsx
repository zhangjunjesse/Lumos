'use client';

import * as React from 'react';

import { CONVERGED_CLUSTERS, CONVERGED_OUTLIERS, CONVERGED_REJECTED } from '../mock-data';
import type { Cluster, NicheTypeId, RejectReason } from '../etsy-erank-types';

const PRIORITY_META: Record<Cluster['priority'], { label: string; cls: string }> = {
  1: { label: '优先', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30' },
  2: { label: '次选', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  3: { label: '边缘', cls: 'bg-muted text-muted-foreground ring-border' },
};

const TYPE_LABEL: Partial<Record<NicheTypeId, string>> = {
  wedding_engagement: '婚礼/订婚',
  jewelry: '首饰',
  apparel_design: '服装设计',
  digital_download: '数字下载',
  home_decor: '家居装饰',
  home_organization: '家居收纳',
  stationery_paper: '文具',
  awareness_cause: '公益议题',
  pet_products: '宠物',
  baby_kids: '婴幼儿',
  beauty_personal_care: '美妆',
  pop_culture_fandom: 'IP/影视',
  botanical_plant_art: '花卉植物',
  seasonal_holiday: '节日季节',
  fashion_aesthetic: '美学风格',
  collector_subculture: '兴趣收藏',
  spiritual_wellness: '灵性',
  personalized_gifts: '定制礼物',
  outdoor_adventure: '户外',
  crafts_supplies: '手工原料',
  vehicle_accessories: '车饰',
  memorial_funeral: '纪念礼',
  kitchen_dining: '厨房餐具',
  kids_party: '儿童派对',
  office_workspace: '办公桌面',
  other: '待补 type',
};

const REASON_LABEL: Record<RejectReason, string> = {
  red_ocean: '在售竞争 > 10 万,红海',
  dead_no_search: '无搜索量',
  dead_no_click: '无点击意图',
  too_broad_single_word: '宽泛类目单词',
  duplicate: '重复',
};

function SeasonalityBadge({ value }: { value: string }) {
  if (value === 'evergreen')
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
        常青
      </span>
    );
  if (value.startsWith('seasonal:')) {
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-500/30">
        季节 · {value.slice('seasonal:'.length)}
      </span>
    );
  }
  return null;
}

function ClusterCard({ c }: { c: Cluster }) {
  const [open, setOpen] = React.useState(false);
  const pm = PRIORITY_META[c.priority];
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 bg-muted/40 px-3 py-2.5 text-left hover:bg-muted/60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{c.name}</span>
            <span
              className={`rounded-full bg-background px-2 py-0.5 text-[10px] ring-1 ${
                c.niche_type_id === 'other'
                  ? 'text-amber-700 ring-amber-500/30'
                  : 'text-muted-foreground ring-border'
              }`}
              title={`niche_type_id: ${c.niche_type_id}`}
            >
              {TYPE_LABEL[c.niche_type_id] ?? c.niche_type_id}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${pm.cls}`}>{pm.label}</span>
            <SeasonalityBadge value={c.seasonality} />
            <span className="rounded bg-background px-1.5 py-0.5 text-xs tabular-nums ring-1 ring-border">
              {1 + c.variants.length}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-foreground">{c.core}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="space-y-3 bg-background px-3 py-3 text-xs">
          <div className="space-y-1 rounded-lg bg-muted/30 px-3 py-2">
            <p>
              <span className="text-muted-foreground">竞争证据:</span>{' '}
              <span className="text-foreground">{c.rationale.evidence_competition}</span>
            </p>
            <p>
              <span className="text-muted-foreground">意图证据:</span>{' '}
              <span className="text-foreground">{c.rationale.evidence_intent}</span>
            </p>
            <p>
              <span className="text-muted-foreground">能力匹配:</span>{' '}
              <span className="text-foreground">{c.rationale.evidence_capability_match}</span>
            </p>
          </div>

          {c.broad_subordinates.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                宽泛副词(同 niche · 只当标题副词蹭量,不主攻)
              </p>
              <div className="flex flex-wrap gap-1">
                {c.broad_subordinates.map((b) => (
                  <span
                    key={b}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground line-through"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              候选长尾(送 ④ 真实验证)· core + 1 维度修饰
            </p>
            <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums sm:grid-cols-2">
              <div className="text-foreground">
                <span className="text-emerald-700">●</span> {c.core}{' '}
                <span className="text-[9px] text-muted-foreground">(核心)</span>
              </div>
              {c.variants.map((v) => (
                <div key={v} className="text-foreground">
                  <span className="text-muted-foreground">○</span> {v}
                </div>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground">
            候选证据:{' '}
            <span className="font-mono">{c.core_evidence_from_input.join(', ')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ClustersTable(): React.ReactElement {
  const [showOutliers, setShowOutliers] = React.useState(false);
  const [showRejected, setShowRejected] = React.useState(false);
  const total = CONVERGED_CLUSTERS.reduce((n, c) => n + 1 + c.variants.length, 0);

  return (
    <div className="mt-2 space-y-3">
      {/* 顶部统计 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">
          {CONVERGED_CLUSTERS.length} 个 niche · {total} 词候选
        </span>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={() => setShowOutliers(!showOutliers)}
          className="text-muted-foreground hover:text-foreground"
        >
          {showOutliers ? '隐藏' : '查看'} {CONVERGED_OUTLIERS.length} 个孤词
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={() => setShowRejected(!showRejected)}
          className="text-muted-foreground hover:text-foreground"
        >
          {showRejected ? '隐藏' : '查看'} {CONVERGED_REJECTED.length} 个剔除明细
        </button>
      </div>

      {/* niche 卡片 */}
      <div className="space-y-2">
        {CONVERGED_CLUSTERS.map((c) => (
          <ClusterCard key={c.core} c={c} />
        ))}
      </div>

      {/* 孤词(展开) */}
      {showOutliers && (
        <div className="rounded-xl bg-muted/20 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            孤词(语义无邻居 · 不进 niche,留 ④ 单独验证或下轮观察)
          </p>
          <div className="flex flex-wrap gap-1">
            {CONVERGED_OUTLIERS.map((o) => (
              <span
                key={o}
                className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border"
              >
                {o}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 剔除明细(展开) */}
      {showRejected && (
        <div className="overflow-hidden rounded-xl ring-1 ring-border">
          <div className="bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            剔除明细 · 来自第 1 层 code 预过滤(可审计每条原因 + 数据)
          </div>
          <div className="max-h-64 overflow-y-auto bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background text-[10px] uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">关键词</th>
                  <th className="px-2 py-1.5 text-left font-medium">来源</th>
                  <th className="px-2 py-1.5 text-left font-medium">原因</th>
                  <th className="px-2 py-1.5 text-right font-medium">数据</th>
                </tr>
              </thead>
              <tbody>
                {CONVERGED_REJECTED.map((r, i) => (
                  <tr key={r.keyword + i} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-2 py-1 font-mono text-foreground">{r.keyword}</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {r.source === 'Trend Buzz' ? '近期上涨' : '长期趋势'}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{REASON_LABEL[r.reason]}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {r.stats?.competition ? `竞争 ${r.stats.competition.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
