/**
 * X 雷达海报渲染：各 block（brand strip / title / hook / KPI / insight / quotes / actions / footer）。
 * 拆出来让 report-poster.ts 保持在 300 行硬限内。
 */

import React from 'react';

import { parseSimpleMarkdown, kpiValueFontSize, type InsightBlock } from './report-poster-utils';

export interface PosterTheme {
  bg: string; bgAccent: string;
  fg: string; muted: string;
  accent: string; accentBg: string; accentFg: string;
  divider: string; card: string; cardBorder: string;
  h1: string; quoteBar: string;
  /** Hook 卡片配色（可选；minimal 主题用浅底深字反差） */
  hookBg?: string; hookFg?: string; hookLabelFg?: string; hookSeqFg?: string;
}

export function renderBrandStrip(theme: PosterTheme): React.ReactElement {
  return React.createElement('div', {
    key: 'brand', style: {
      display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: 24, marginBottom: 24,
    },
  }, [
    React.createElement('div', {
      key: 'left', style: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
    }, [
      React.createElement('div', {
        key: 'b', style: {
          width: 72, height: 72, borderRadius: 18,
          backgroundColor: theme.accent, color: '#ffffff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 38, fontWeight: 800, marginRight: 24,
        },
      }, 'X'),
      React.createElement('div', {
        key: 't', style: { fontSize: 36, fontWeight: 800, color: theme.h1, lineHeight: 1.2 },
      }, 'X 雷达'),
    ]),
    React.createElement('div', {
      key: 'right', style: { fontSize: 22, color: theme.muted, letterSpacing: 6 },
    }, 'WEEKLY · REPORT'),
  ]);
}

export function renderTitle(title: string, subtitle: string | undefined, theme: PosterTheme): React.ReactElement {
  return React.createElement('div', {
    key: 'title', style: { display: 'flex', flexDirection: 'column', marginTop: 24, marginBottom: 56 },
  }, [
    React.createElement('div', {
      key: 't', style: { fontSize: 76, fontWeight: 800, color: theme.h1, lineHeight: 1.18 },
    }, title),
    subtitle ? React.createElement('div', {
      key: 's', style: { fontSize: 30, color: theme.muted, marginTop: 24, lineHeight: 1.4 },
    }, subtitle) : null,
  ].filter(Boolean));
}

export function renderHookCard(hook: string, theme: PosterTheme): React.ReactElement {
  const bg = theme.hookBg ?? theme.accent;
  const fg = theme.hookFg ?? '#ffffff';
  const labelFg = theme.hookLabelFg ?? 'rgba(255,255,255,0.9)';
  const seqFg = theme.hookSeqFg ?? 'rgba(255,255,255,0.35)';
  return React.createElement('div', {
    key: 'hook', style: {
      display: 'flex', flexDirection: 'column',
      backgroundColor: bg, color: fg,
      padding: 72, paddingLeft: 72, paddingRight: 72, paddingTop: 64, paddingBottom: 76,
      borderRadius: 40, marginBottom: 88,
      border: theme.hookBg ? `2px solid ${theme.cardBorder}` : 'none',
    },
  }, [
    React.createElement('div', {
      key: 'top', style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 },
    }, [
      React.createElement('div', {
        key: 'l', style: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
      }, [
        React.createElement('div', {
          key: 'd', style: { width: 32, height: 4, backgroundColor: labelFg, marginRight: 18 },
        }),
        React.createElement('div', {
          key: 't', style: { fontSize: 22, fontWeight: 700, color: labelFg, letterSpacing: 6 },
        }, 'THE HOOK · 本期金句'),
      ]),
      React.createElement('div', {
        key: 'r', style: { fontSize: 32, fontWeight: 800, color: seqFg, letterSpacing: 2 },
      }, '#01'),
    ]),
    React.createElement('div', {
      key: 't', style: { fontSize: 64, fontWeight: 800, color: fg, lineHeight: 1.35 },
    }, hook),
  ]);
}

export function renderKpiGrid(kpis: { value: string; label: string }[], theme: PosterTheme): React.ReactElement {
  // 3 个 → 单行 3 列；4 个 → 2x2；5+ 个 → 2x2 + 余 1 单独行
  const rows: typeof kpis[] = [];
  if (kpis.length === 3) {
    rows.push(kpis);
  } else {
    for (let i = 0; i < kpis.length; i += 2) rows.push(kpis.slice(i, i + 2));
  }
  const cols = kpis.length === 3 ? 3 : 2;
  return React.createElement('div', {
    key: 'kpis', style: { display: 'flex', flexDirection: 'column', gap: 28, marginBottom: 88 },
  }, rows.map((row, ri) => React.createElement('div', {
    key: `r-${ri}`, style: { display: 'flex', flexDirection: 'row', gap: 28 },
  }, row.map((k, i) => React.createElement('div', {
    key: `k-${ri}-${i}`, style: {
      flex: 1, backgroundColor: theme.card, border: `2px solid ${theme.cardBorder}`,
      borderRadius: 28, padding: cols === 3 ? 32 : 44, paddingTop: 36, paddingBottom: 40,
      display: 'flex', flexDirection: 'column',
    },
  }, [
    React.createElement('div', { key: 'top', style: { width: 36, height: 4, backgroundColor: theme.accent, borderRadius: 3, marginBottom: 24 } }),
    React.createElement('div', {
      key: 'v', style: {
        fontSize: kpiValueFontSize(k.value, cols), fontWeight: 800, color: theme.accent,
        lineHeight: 1.05, marginBottom: 18, whiteSpace: 'nowrap',
      },
    }, k.value),
    React.createElement('div', {
      key: 'l', style: { fontSize: cols === 3 ? 20 : 24, color: theme.muted, lineHeight: 1.5, fontWeight: 500 },
    }, k.label),
  ])))));
}

export function renderInsightSection(insight: string, theme: PosterTheme): React.ReactElement {
  const blocks = parseSimpleMarkdown(insight);
  // 给每个 h2 单独编号（让 01 02 03 真实对应 section 序号而非 idx 公式）
  let h2Counter = 0;
  return React.createElement('div', {
    key: 'insight', style: { display: 'flex', flexDirection: 'column', marginBottom: 64 },
  }, [
    renderSectionLabel('本期看点', theme, 'l-i'),
    React.createElement('div', {
      key: 'body', style: {
        backgroundColor: theme.card, border: `2px solid ${theme.cardBorder}`,
        borderRadius: 24, padding: 52,
        display: 'flex', flexDirection: 'column',
      },
    }, blocks.map((b, i) => {
      if (b.kind === 'h' && b.level === 2) h2Counter += 1;
      const h2Num = b.kind === 'h' && b.level === 2 ? h2Counter : 0;
      return renderInsightBlock(b, theme, i, h2Num);
    })),
  ]);
}

function renderInsightBlock(block: InsightBlock, theme: PosterTheme, idx: number, h2Num: number): React.ReactElement {
  const key = `ib-${idx}`;
  if (block.kind === 'blank') return React.createElement('div', { key, style: { height: 16 } });
  if (block.kind === 'h') {
    if (block.level === 2) {
      return React.createElement('div', {
        key, style: {
          display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
          marginTop: idx === 0 ? 0 : 64, marginBottom: 24,
        },
      }, [
        React.createElement('div', {
          key: 'n', style: {
            fontSize: 36, fontWeight: 800, color: theme.accent,
            lineHeight: 1.1, minWidth: 56, marginRight: 14, letterSpacing: -1,
          },
        }, `0${Math.min(9, h2Num)}`),
        React.createElement('div', {
          key: 't', style: {
            flex: 1, fontSize: 34, fontWeight: 800, color: theme.h1, lineHeight: 1.4,
          },
        }, block.text),
      ]);
    }
    return React.createElement('div', {
      key, style: {
        fontSize: 36, fontWeight: 700, color: theme.h1,
        lineHeight: 1.35, marginTop: idx === 0 ? 0 : 36, marginBottom: 18,
      },
    }, block.text);
  }
  if (block.kind === 'list') {
    return React.createElement('div', {
      key, style: {
        display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
        fontSize: 28, color: theme.fg, lineHeight: 1.85, marginBottom: 12,
      },
    }, [
      React.createElement('div', {
        key: 'b', style: {
          width: 10, height: 10, borderRadius: 5, marginTop: 18, marginRight: 16,
          backgroundColor: theme.accent, flexShrink: 0,
        },
      }),
      React.createElement('div', { key: 't', style: { flex: 1 } }, block.text),
    ]);
  }
  return React.createElement('div', {
    key, style: { fontSize: 28, color: theme.fg, lineHeight: 1.95, marginTop: 4, marginBottom: 8 },
  }, block.text);
}

function renderSectionLabel(text: string, theme: PosterTheme, key: string): React.ReactElement {
  return React.createElement('div', {
    key, style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  }, [
    React.createElement('div', {
      key: 'bar', style: { width: 8, height: 40, backgroundColor: theme.accent, borderRadius: 4, marginRight: 18 },
    }),
    React.createElement('div', {
      key: 't', style: { fontSize: 38, fontWeight: 700, color: theme.h1, lineHeight: 1.2 },
    }, text),
  ]);
}

export function renderQuotesSection(quotes: { text: string; author: string; url?: string }[], theme: PosterTheme): React.ReactElement {
  return React.createElement('div', {
    key: 'quotes', style: { display: 'flex', flexDirection: 'column', marginBottom: 80 },
  }, [
    renderSectionLabel('金句墙', theme, 'l-q'),
    React.createElement('div', {
      key: 'list', style: { display: 'flex', flexDirection: 'column' },
    }, quotes.map((q, i) => React.createElement('div', {
      key: `q-${i}`, style: {
        display: 'flex', flexDirection: 'column', padding: 48,
        backgroundColor: theme.card, border: `2px solid ${theme.cardBorder}`,
        borderRadius: 24, marginBottom: 24,
      },
    }, [
      React.createElement('div', {
        key: 'top', style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
      }, [
        React.createElement('div', {
          key: 'qm', style: { fontSize: 72, fontWeight: 800, color: theme.accent, lineHeight: 0.8, opacity: 0.35 },
        }, '"'),
        React.createElement('div', {
          key: 'num', style: {
            fontSize: 22, fontWeight: 700, color: theme.muted, letterSpacing: 4,
          },
        }, `QUOTE 0${i + 1}`),
      ]),
      React.createElement('div', {
        key: 't', style: { fontSize: 34, color: theme.fg, lineHeight: 1.7, fontWeight: 500 },
      }, q.text),
      React.createElement('div', {
        key: 'a', style: {
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          marginTop: 28, paddingTop: 24, borderTop: `1px solid ${theme.divider}`,
        },
      }, [
        React.createElement('div', {
          key: 'dot', style: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent, marginRight: 14 },
        }),
        React.createElement('div', {
          key: 'name', style: { fontSize: 28, color: theme.accent, fontWeight: 700 },
        }, `@${q.author}`),
      ]),
    ]))),
  ]);
}

export function renderActionsSection(actions: string[], theme: PosterTheme): React.ReactElement {
  return React.createElement('div', {
    key: 'actions', style: { display: 'flex', flexDirection: 'column', marginBottom: 64 },
  }, [
    renderSectionLabel('下一步行动', theme, 'l-a'),
    ...actions.map((a, i) => React.createElement('div', {
      key: `a-${i}`, style: {
        display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
        backgroundColor: theme.card, border: `2px solid ${theme.cardBorder}`,
        borderRadius: 24, padding: 40, marginBottom: 22,
      },
    }, [
      React.createElement('div', {
        key: 'n', style: {
          fontSize: 44, fontWeight: 800, color: theme.accent, lineHeight: 1.1,
          marginRight: 24, minWidth: 56,
        },
      }, `0${i + 1}`),
      React.createElement('div', {
        key: 't', style: { flex: 1, fontSize: 30, color: theme.fg, lineHeight: 1.7, fontWeight: 500 },
      }, a),
    ])),
  ]);
}

export function renderFooter(theme: PosterTheme, generatedAt?: string): React.ReactElement {
  return React.createElement('div', {
    key: 'footer', style: {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 24, paddingTop: 32, borderTop: `2px solid ${theme.divider}`,
      fontSize: 24, color: theme.muted,
    },
  }, [
    React.createElement('div', { key: 'l' }, 'Lumos · X 雷达'),
    React.createElement('div', { key: 'r' }, generatedAt ?? new Date().toLocaleString('zh-CN')),
  ]);
}
