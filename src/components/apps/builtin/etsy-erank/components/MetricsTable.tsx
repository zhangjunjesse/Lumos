'use client';

import * as React from 'react';

import { BULK_METRICS_REAL as MOCK_METRICS } from '../mock-data';
import type { BulkMetric, Grade } from '../etsy-erank-types';

const GRADE_META: Record<Grade, { label: string; cls: string }> = {
  A: { label: 'A · 主攻', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30' },
  B: { label: 'B · 可做', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  C: { label: 'C · 副词', cls: 'bg-amber-500/10 text-amber-700 ring-amber-500/30' },
  drop: { label: '淘汰', cls: 'bg-muted text-muted-foreground ring-border' },
};

function gradeRank(g: Grade): number {
  return { A: 0, B: 1, C: 2, drop: 3 }[g];
}

function ucellCls(v: string): string {
  if (v === 'Unknown' || v === '< 20' || v === '< 20%' || v === '0') return 'text-muted-foreground';
  return 'text-foreground';
}

function gradeBadge(g: Grade): React.ReactElement {
  const m = GRADE_META[g];
  return (
    <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ${m.cls}`}>
      {m.label}
    </span>
  );
}

export interface MetricsTableProps {
  rows?: BulkMetric[];
  isMock?: boolean;
}

export function MetricsTable({ rows, isMock }: MetricsTableProps = {}): React.ReactElement {
  const metrics = rows ?? MOCK_METRICS;
  const effectiveIsMock = isMock ?? !rows;
  const [sortBy, setSortBy] = React.useState<'grade' | 'searches' | 'kd' | 'competition'>('grade');
  const [filterGrade, setFilterGrade] = React.useState<Grade | 'all'>('all');
  const [openSeeds, setOpenSeeds] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    metrics.forEach((r) => {
      if (r.grade === 'A' || r.grade === 'B') s.add(r.seed);
    });
    return s;
  });

  // 统计 / 分组
  const stats = React.useMemo(() => {
    const s = { A: 0, B: 0, C: 0, drop: 0 };
    metrics.forEach((r) => (s[r.grade] += 1));
    return s;
  }, [metrics]);

  const grouped = React.useMemo(() => {
    const m = new Map<string, BulkMetric[]>();
    for (const r of metrics) {
      if (filterGrade !== 'all' && r.grade !== filterGrade) continue;
      const arr = m.get(r.seed) ?? [];
      arr.push(r);
      m.set(r.seed, arr);
    }
    // 每个 niche 内排序
    for (const [, arr] of m) {
      arr.sort((a, b) => {
        if (sortBy === 'grade') return gradeRank(a.grade) - gradeRank(b.grade);
        if (sortBy === 'searches') {
          const av = parseInt((a.searches || '0').replace(/,/g, '')) || 0;
          const bv = parseInt((b.searches || '0').replace(/,/g, '')) || 0;
          return bv - av;
        }
        if (sortBy === 'kd') return (parseInt(a.kd) || 0) - (parseInt(b.kd) || 0);
        if (sortBy === 'competition') {
          const av = parseInt((a.competition || '0').replace(/,/g, '')) || 0;
          const bv = parseInt((b.competition || '0').replace(/,/g, '')) || 0;
          return av - bv;
        }
        return 0;
      });
    }
    // niche 内有 A/B 级的优先排前
    return [...m.entries()].sort((a, b) => {
      const ag = Math.min(...a[1].map((r) => gradeRank(r.grade)));
      const bg = Math.min(...b[1].map((r) => gradeRank(r.grade)));
      return ag - bg;
    });
  }, [sortBy, filterGrade, metrics]);

  const toggleSeed = (n: string) => {
    const next = new Set(openSeeds);
    next.has(n) ? next.delete(n) : next.add(n);
    setOpenSeeds(next);
  };

  return (
    <div className="mt-2 space-y-2">
      {effectiveIsMock && (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20">
          当前展示 DEMO 数据。先跑完 ③ 扩词,再点 ④ 上方的&ldquo;跑 ④ Bulk 验真&rdquo;按钮。
        </div>
      )}
      {/* 顶部统计 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">{effectiveIsMock ? 'DEMO' : '真实跑出'} {metrics.length} 词 ·</span>
        {(['A', 'B', 'C', 'drop'] as Grade[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setFilterGrade(filterGrade === g ? 'all' : g)}
            className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${
              filterGrade === g ? GRADE_META[g].cls : 'text-muted-foreground ring-border'
            }`}
          >
            {GRADE_META[g].label} · {stats[g]}
          </button>
        ))}
        {filterGrade !== 'all' && (
          <button
            type="button"
            onClick={() => setFilterGrade('all')}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            清除筛选
          </button>
        )}
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          排序:
          {(['grade', 'searches', 'kd', 'competition'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortBy(k)}
              className={`rounded px-1.5 py-0.5 ring-1 ${
                sortBy === k ? 'bg-background ring-border' : 'text-muted-foreground ring-transparent hover:ring-border'
              }`}
            >
              {{ grade: '档', searches: '月搜', kd: 'KD', competition: '竞争' }[k]}
            </button>
          ))}
        </div>
      </div>

      {/* 按 seed 分组卡片 */}
      {grouped.map(([seed, rows]) => {
        const isOpen = openSeeds.has(seed);
        const bestGrade = rows.reduce<Grade>(
          (best, r) => (gradeRank(r.grade) < gradeRank(best) ? r.grade : best),
          'drop',
        );
        const gradeCount = { A: 0, B: 0, C: 0, drop: 0 };
        rows.forEach((r) => (gradeCount[r.grade] += 1));
        return (
          <div key={seed} className="overflow-hidden rounded-xl ring-1 ring-border">
            <button
              type="button"
              onClick={() => toggleSeed(seed)}
              className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-left hover:bg-muted/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{seed}</span>
                {gradeBadge(bestGrade)}
                <span className="text-[10px] text-muted-foreground">
                  {rows.length} 词
                  {gradeCount.A > 0 && <span className="text-emerald-700"> · A {gradeCount.A}</span>}
                  {gradeCount.B > 0 && <span className="text-sky-700"> · B {gradeCount.B}</span>}
                  {gradeCount.C > 0 && <span className="text-amber-700"> · C {gradeCount.C}</span>}
                  {gradeCount.drop > 0 && <span> · 淘 {gradeCount.drop}</span>}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{isOpen ? '收起' : '展开'}</span>
            </button>
            {isOpen && (
              <div className="overflow-x-auto bg-background">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-2 py-1.5 text-left font-medium">档</th>
                      <th className="px-2 py-1.5 text-left font-medium">关键词</th>
                      <th className="px-2 py-1.5 text-right font-medium">月搜</th>
                      <th className="px-2 py-1.5 text-right font-medium">月点</th>
                      <th className="px-2 py-1.5 text-right font-medium">CTR</th>
                      <th className="px-2 py-1.5 text-right font-medium">在售竞争</th>
                      <th className="px-2 py-1.5 text-right font-medium">KD</th>
                      <th className="px-2 py-1.5 text-right font-medium">Google</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.keyword}
                        className={`border-b last:border-0 hover:bg-muted/20 ${
                          r.grade === 'drop' ? 'opacity-60' : ''
                        }`}
                      >
                        <td className="px-2 py-1">{gradeBadge(r.grade)}</td>
                        <td className="px-2 py-1 font-medium text-foreground">
                          {r.keyword}
                          {r.sources.includes('seed') && (
                            <span className="ml-1 text-[9px] text-emerald-700">●种子</span>
                          )}
                          {r.sources.includes('B') && !r.sources.includes('seed') && (
                            <span className="ml-1 rounded bg-sky-500/10 px-1 text-[9px] text-sky-700 ring-1 ring-sky-500/30" title="Etsy autocomplete 真实买家搜索词">
                              B
                            </span>
                          )}
                          {r.sources.includes('C') && !r.sources.includes('seed') && (
                            <span className="ml-1 rounded bg-emerald-500/10 px-1 text-[9px] text-emerald-700 ring-1 ring-emerald-500/30" title="Etsy listing 标题 ngram">
                              C
                            </span>
                          )}
                        </td>
                        <td className={`px-2 py-1 text-right ${ucellCls(r.searches)}`}>
                          {r.searches}
                        </td>
                        <td className={`px-2 py-1 text-right ${ucellCls(r.clicks)}`}>
                          {r.clicks}
                        </td>
                        <td className={`px-2 py-1 text-right ${ucellCls(r.ctr)}`}>{r.ctr}</td>
                        <td className={`px-2 py-1 text-right ${ucellCls(r.competition)}`}>
                          {r.competition}
                        </td>
                        <td
                          className={`px-2 py-1 text-right ${
                            r.kd === '100'
                              ? 'text-red-600'
                              : Number(r.kd) >= 60
                                ? 'text-amber-600'
                                : Number(r.kd) > 0
                                  ? 'text-emerald-700'
                                  : 'text-muted-foreground'
                          }`}
                        >
                          {r.kd}
                        </td>
                        <td className={`px-2 py-1 text-right ${ucellCls(r.google)}`}>
                          {r.google}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        SOP §3.2:月搜&lt;100 / CTR=Unknown / 在售竞争&gt;10万 / KD=100 任一即淘汰。Unknown / &lt;20 表示数据极低或缺失,等同死词。
      </p>
    </div>
  );
}
