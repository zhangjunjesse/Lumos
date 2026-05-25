'use client';

import * as React from 'react';

import { SEEDS as MOCK_SEEDS } from '../mock-data';
import type { SeedTerm } from '../etsy-erank-types';

/** 产品化标题:不暴露 eRank 工具名,告诉用户这堆词是什么、为什么有用 */
const SOURCE_META: Record<
  SeedTerm['sourceTool'],
  { title: string; subtitle: string; icon: string }
> = {
  'Trend Buzz': { icon: '🔥', title: '近期上涨', subtitle: '搜索量上升最快' },
  'Monthly Trends': { icon: '📈', title: '长期趋势', subtitle: '过去 15 个月最热' },
  'Category Report': { icon: '📂', title: '类目热词', subtitle: '' },
  'Top Sellers': { icon: '🏆', title: '头部店铺', subtitle: '' },
};

/** 把 "↑ 223" / "↓ 1" / "-" / "1,234" / "Unknown" / "< 20" 都能比较 */
function toNumber(s: string | undefined): number {
  if (!s) return -Infinity;
  if (s === '-' || s === 'Unknown') return -Infinity;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return -Infinity;
  const n = Number(m[0]);
  if (s.startsWith('↓')) return -n;
  if (s.startsWith('<')) return n - 0.5; // <20 排在 20 前
  return n;
}

type SortKey = 'rank' | 'change' | 'avgSearches' | 'avgCtr' | 'competition' | 'trendNote';
type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: SortKey;
  label: string;
  hint: string;
  align: 'left' | 'right';
}

const TREND_BUZZ_COLS: ColumnDef[] = [
  { key: 'change', label: '涨跌', hint: '相对前一窗口的搜索量变化:↑ 上升 / ↓ 下降 / - 持平', align: 'right' },
  { key: 'avgSearches', label: '月搜', hint: '该词每月搜索次数(估算)', align: 'right' },
  { key: 'avgCtr', label: '买家意图', hint: '搜了之后真去点的人占比;>100% 表示一次搜索带多次点击,Unknown = 几乎没人点,死词', align: 'right' },
  { key: 'competition', label: '在售竞争', hint: 'Etsy 上挂着该词的商品数量,越大越红海', align: 'right' },
];

const MONTHLY_COLS: ColumnDef[] = [
  { key: 'avgSearches', label: '近 15 月均搜', hint: '过去 15 个月的平均月搜索量', align: 'right' },
  { key: 'trendNote', label: '顶峰月份', hint: '15 个月里搜索量最高的那个月份 + 该月的搜索次数', align: 'left' },
];

export interface SeedTableProps {
  seeds?: SeedTerm[];   // 父组件传真数据;不传则用 mock
  isMock?: boolean;     // 显示 DEMO 标
}

export function SeedTable({ seeds, isMock }: SeedTableProps = {}): React.ReactElement {
  const effectiveSeeds = seeds ?? MOCK_SEEDS;
  const effectiveIsMock = isMock ?? !seeds;
  const [open, setOpen] = React.useState<Set<string>>(
    new Set(['Trend Buzz', 'Monthly Trends']),
  );
  const [sortBy, setSortBy] = React.useState<Record<string, { key: SortKey; dir: SortDir }>>({
    'Trend Buzz': { key: 'rank', dir: 'asc' },
    'Monthly Trends': { key: 'rank', dir: 'asc' },
  });

  const grouped = React.useMemo(() => {
    const m = new Map<SeedTerm['sourceTool'], SeedTerm[]>();
    for (const s of effectiveSeeds) {
      const arr = m.get(s.sourceTool) ?? [];
      arr.push(s);
      m.set(s.sourceTool, arr);
    }
    return [...m.entries()];
  }, [effectiveSeeds]);

  const toggle = (src: string) => {
    const next = new Set(open);
    if (next.has(src)) next.delete(src);
    else next.add(src);
    setOpen(next);
  };

  const setSort = (src: string, key: SortKey) => {
    setSortBy((prev) => {
      const cur = prev[src];
      const dir: SortDir = cur?.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : 'desc';
      return { ...prev, [src]: { key, dir } };
    });
  };

  const sortedRows = (src: string, rows: SeedTerm[]) => {
    const sort = sortBy[src] ?? { key: 'rank' as SortKey, dir: 'asc' as SortDir };
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sort.key === 'rank' ? Number(a.rank) || 0 : toNumber(a[sort.key]);
      const bv = sort.key === 'rank' ? Number(b.rank) || 0 : toNumber(b[sort.key]);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  };

  const total = effectiveSeeds.length;
  const trendBuzzCount = grouped.find(([k]) => k === 'Trend Buzz')?.[1].length ?? 0;
  const monthlyCount = grouped.find(([k]) => k === 'Monthly Trends')?.[1].length ?? 0;

  return (
    <div className="mt-2 space-y-3">
      {effectiveIsMock && (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20">
          当前展示的是 DEMO 数据。点 ② 上方的&ldquo;跑 ② 抓种子&rdquo;按钮即可启动真实采集。
        </div>
      )}

      {/* 范围说明 */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed">
        <div className="mb-1 font-semibold text-foreground">这步在抓什么</div>
        <div className="text-muted-foreground">
          从 eRank 两个数据看板拉&ldquo;Etsy 买家正在搜什么&rdquo;,得到 <span className="font-semibold text-foreground tabular-nums">{total}</span> 个种子词,送 ③ 扩词。<br />
          ·&nbsp; <span className="text-foreground">近期上涨</span>(Trend Buzz):<span className="text-foreground">昨天一天</span>搜索量涨得最快的 <span className="tabular-nums">{trendBuzzCount}</span> 个词,捕捉新热点 <span className="text-[10px]">(eRank 可切 Yesterday / Last 30 Days / 任意单月,本轮抓 Yesterday)</span><br />
          ·&nbsp; <span className="text-foreground">长期趋势</span>(Monthly Trends):<span className="text-foreground">过去 15 个月</span>持续高频的 <span className="tabular-nums">{monthlyCount}</span> 个词,捕捉稳定刚需<br />
          ·&nbsp; 抓的是&ldquo;买家搜索词&rdquo;不是&ldquo;在卖商品&rdquo;;市场默认美国 Etsy(eRank 平台默认)<br />
          ·&nbsp; 不烧 eRank 配额(两个看板免费),也不会动你当前浏览器
        </div>
      </div>

      {grouped.map(([src, rows]) => {
        const isOpen = open.has(src);
        const meta = SOURCE_META[src];
        const cols = src === 'Trend Buzz' ? TREND_BUZZ_COLS : src === 'Monthly Trends' ? MONTHLY_COLS : [];
        const sort = sortBy[src];
        const data = isOpen ? sortedRows(src, rows) : rows;
        return (
          <div key={src} className="overflow-hidden rounded-xl ring-1 ring-border">
            <button
              type="button"
              onClick={() => toggle(src)}
              className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2.5 text-left hover:bg-muted/60"
            >
              <div className="flex items-center gap-2">
                <span className="text-base" aria-hidden>
                  {meta.icon}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{meta.title}</span>
                  {meta.subtitle && (
                    <span className="text-xs text-muted-foreground">{meta.subtitle}</span>
                  )}
                  <span className="rounded bg-background px-1.5 py-0.5 text-xs tabular-nums ring-1 ring-border">
                    {rows.length}
                  </span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">{isOpen ? '收起' : '展开'}</span>
            </button>
            {isOpen && (
              <div className="max-h-[440px] overflow-y-auto bg-background">
                <table className="w-full text-xs tabular-nums">
                  <thead className="sticky top-0 z-10 bg-background text-[11px] uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">
                        <button type="button" onClick={() => setSort(src, 'rank')} className="hover:text-foreground">
                          # {sort?.key === 'rank' ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                      </th>
                      <th className="px-2 py-2 text-left font-medium">关键词</th>
                      {cols.map((c) => (
                        <th key={c.key} className={`px-2 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`} title={c.hint}>
                          <button
                            type="button"
                            onClick={() => setSort(src, c.key)}
                            className="cursor-help hover:text-foreground"
                            title={c.hint}
                          >
                            {c.label}
                            {sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r) => (
                      <tr key={`${src}-${r.keyword}-${r.rank}`} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.rank ?? '-'}</td>
                        <td className="px-2 py-1.5 font-medium text-foreground">{r.keyword}</td>
                        {src === 'Trend Buzz' && (
                          <>
                            <td className={`px-2 py-1.5 text-right ${r.change?.startsWith('↑') ? 'text-emerald-700' : r.change?.startsWith('↓') ? 'text-red-700' : 'text-muted-foreground'}`}>
                              {r.change ?? '-'}
                            </td>
                            <td className={`px-2 py-1.5 text-right ${r.avgSearches === 'Unknown' || r.avgSearches?.startsWith('<') ? 'text-muted-foreground' : 'text-foreground'}`}>
                              {r.avgSearches ?? '-'}
                            </td>
                            <td className={`px-2 py-1.5 text-right ${r.avgCtr === 'Unknown' ? 'text-red-600' : 'text-foreground'}`}>
                              {r.avgCtr ?? '-'}
                            </td>
                            <td className="px-2 py-1.5 text-right text-foreground">{r.competition ?? '-'}</td>
                          </>
                        )}
                        {src === 'Monthly Trends' && (
                          <>
                            <td className="px-2 py-1.5 text-right text-foreground">{r.avgSearches ?? '-'}</td>
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">{r.trendNote ?? '-'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
