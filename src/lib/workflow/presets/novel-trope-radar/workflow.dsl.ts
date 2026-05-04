/**
 * 网文套路雷达 V3 DSL — inline script 版
 *
 * 每个 agent 节点的 input.code.script 都是自包含的 JS,
 * 没有 handler 引用,没有外部 registry 依赖。
 *
 * 节点拓扑 (N = runParams.platforms.length):
 *
 *   N>=2: [parallel] -> N × fetch_rankings_<p> -> [join] -> dedup ->
 *         for_each_books { fetch_detail -> save_book } -> aggregate
 *
 *   N==1: fetch_rankings_<p> -> dedup -> for_each_books { ... } -> aggregate
 *
 * 数据落盘:每本书的元数据/试读章/书评 JSON 写入 ctx.outputDir;
 * 周报 markdown 也写入 ctx.outputDir。后续如要进 KB,可挂第二个步骤
 * 通过现有 /api/knowledge/items 导入。
 */

import type {
  AgentNode,
  ForEachNode,
  JoinNode,
  ParallelNode,
  WorkflowDSLV3,
  WorkflowEdge,
  WorkflowNode,
} from '@/lib/workflow/types-v3';
import type {
  NovelTropeRadarRunParams,
  PlatformConfig,
  PlatformKey,
} from './types';
import { ALL_PLATFORM_CONFIGS } from './platform-configs';

// ─── 浏览器内提取脚本 (运行在页面 DOM 上下文,evaluate 调用) ─────────────────

function buildRankExtractScript(s: PlatformConfig['rank']['selectors']): string {
  return `(() => {
    const items = Array.from(document.querySelectorAll(${JSON.stringify(s.listItem)}));
    const pick = (root, sel) => {
      const n = sel ? root.querySelector(sel) : null;
      return n ? (n.textContent || '').trim() : '';
    };
    return items.map((el) => {
      const link = el.querySelector(${JSON.stringify(s.link)});
      return {
        title: pick(el, ${JSON.stringify(s.title)}),
        author: pick(el, ${JSON.stringify(s.author)}),
        category: pick(el, ${JSON.stringify(s.category)}),
        intro: pick(el, ${JSON.stringify(s.intro)}),
        href: link ? link.getAttribute('href') || '' : '',
        rankBadge: ${s.rankBadge ? `pick(el, ${JSON.stringify(s.rankBadge)})` : '""'},
      };
    });
  })()`;
}

function buildBookExtractScript(s: PlatformConfig['book']['selectors']): string {
  return `(() => {
    const pick = (sel) => {
      const n = document.querySelector(sel);
      return n ? (n.textContent || '').trim() : '';
    };
    const tags = Array.from(document.querySelectorAll(${JSON.stringify(s.tag)}))
      .map((n) => (n.textContent || '').trim()).filter(Boolean);
    const chapters = Array.from(document.querySelectorAll(${JSON.stringify(s.chapterListItem)}))
      .map((el) => {
        const link = el.querySelector(${JSON.stringify(s.chapterLink)});
        const free = ${s.chapterFreeBadge
          ? `el.querySelector(${JSON.stringify(s.chapterFreeBadge)})`
          : 'null'};
        return {
          title: link ? (link.textContent || '').trim() : (el.textContent || '').trim(),
          href: link ? link.getAttribute('href') || '' : '',
          isFree: !!free,
        };
      });
    return {
      title: pick(${JSON.stringify(s.title)}),
      author: pick(${JSON.stringify(s.author)}),
      intro: pick(${JSON.stringify(s.intro)}),
      tags,
      chapters,
    };
  })()`;
}

function buildReaderScript(s: PlatformConfig['book']['reader']): string {
  return `(() => {
    const t = document.querySelector(${JSON.stringify(s.title)});
    const c = document.querySelector(${JSON.stringify(s.content)});
    return {
      title: t ? (t.textContent || '').trim() : '',
      content: c ? (c.textContent || '').trim() : '',
    };
  })()`;
}

// ─── workflow agent inline scripts (运行在 Lumos Node 上下文) ────────────────

const RANKINGS_SCRIPT = `
  const cfg = ctx.params.config;
  const topN = ctx.params.topN || 50;
  await ctx.browser.navigate(cfg.rank.url);
  const raw = await ctx.browser.evaluate(cfg.rank.extractScript);
  if (!Array.isArray(raw)) {
    return { success: true, output: { books: [], platform: cfg.platform, note: '榜单解析返回非数组,选择器可能需校准' } };
  }
  const fetchedAt = new Date().toISOString();
  const out = [];
  const re = new RegExp(cfg.rank.bookIdRegex);
  for (let i = 0; i < raw.length && out.length < topN; i++) {
    const item = raw[i] || {};
    const m = re.exec(item.href || '');
    const bookId = m && m[1] ? m[1] : '';
    if (!bookId || !item.title) continue;
    let url = item.href || '';
    if (!/^https?:\\/\\//i.test(url)) {
      if (url.startsWith('//')) url = 'https:' + url;
      else if (url.startsWith('/')) url = cfg.baseUrl + url;
      else url = cfg.baseUrl + '/' + url;
    }
    out.push({
      bookKey: cfg.platform + ':' + bookId,
      platform: cfg.platform,
      bookId,
      rank: i + 1,
      url,
      title: item.title,
      author: item.author || '',
      category: item.category || '',
      tags: [],
      intro: item.intro || '',
      fetchedAt,
    });
  }
  console.log(cfg.platform + ': 榜单 ' + out.length + ' 本');
  return { success: true, output: { books: out, platform: cfg.platform, count: out.length } };
`;

const DEDUP_SCRIPT = `
  const groups = ctx.params.candidates || [];
  const known = new Set(ctx.params.knownBookKeys || []);
  const seen = new Set();
  const fresh = [];
  for (const g of groups) {
    const list = Array.isArray(g) ? g : (g && Array.isArray(g.books) ? g.books : []);
    for (const b of list) {
      if (!b || !b.bookKey) continue;
      if (known.has(b.bookKey) || seen.has(b.bookKey)) continue;
      seen.add(b.bookKey);
      fresh.push(b);
    }
  }
  return {
    success: true,
    output: { fresh, total: seen.size + known.size, kept: fresh.length, skipped: known.size },
  };
`;

const FETCH_DETAIL_SCRIPT = `
  const book = ctx.params.book;
  const cfg = ctx.params.config;
  const limit = ctx.params.freeChapterLimit || 3;
  const delay = ctx.params.perBookDelayMs || 2000;

  await new Promise(r => setTimeout(r, delay));
  await ctx.browser.navigate(book.url);
  const page = await ctx.browser.evaluate(cfg.book.extractScript);

  const meta = {
    ...book,
    title: page.title || book.title,
    author: page.author || book.author,
    intro: page.intro || book.intro,
    tags: (page.tags && page.tags.length) ? page.tags : book.tags,
  };

  const allCh = (page.chapters || []).filter(c => c && c.href);
  const picked = cfg.book.freeStrategy === 'badge-only'
    ? allCh.filter(c => c.isFree).slice(0, limit)
    : allCh.slice(0, limit);

  const chapters = [];
  for (let i = 0; i < picked.length; i++) {
    const entry = picked[i];
    let url = entry.href;
    if (!/^https?:\\/\\//i.test(url)) {
      if (url.startsWith('//')) url = 'https:' + url;
      else if (url.startsWith('/')) url = cfg.baseUrl + url;
      else url = cfg.baseUrl + '/' + url;
    }
    try {
      await new Promise(r => setTimeout(r, delay));
      await ctx.browser.navigate(url);
      const raw = await ctx.browser.evaluate(cfg.book.readerScript);
      const content = (raw.content || '').replace(/\\r\\n?/g, '\\n').trim();
      if (!content) {
        console.warn(book.bookKey + ' 章 ' + (i+1) + ' 内容空');
        continue;
      }
      chapters.push({
        bookKey: book.bookKey,
        chapterIndex: i + 1,
        chapterTitle: raw.title || entry.title || '第 ' + (i+1) + ' 章',
        url,
        content,
        wordCount: (content.match(/[\\u4e00-\\u9fff]/g) || []).length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(book.bookKey + ' 章 ' + (i+1) + ' 失败: ' + (e && e.message ? e.message : e));
    }
  }

  // 把单本结果 dump 到 outputDir,便于排查 + 后续 KB 导入
  const json = JSON.stringify({ meta, chapters }, null, 2);
  const file = await ctx.saveArtifact(Buffer.from(json, 'utf8'), 'books/' + book.bookKey.replace(':', '_') + '.json');
  console.log(book.bookKey + ' 抓 ' + chapters.length + ' 章 -> ' + file);
  return { success: true, output: { meta, chapters, savedTo: file } };
`;

const AGGREGATE_SCRIPT = `
  const results = ctx.params.results || [];
  const platforms = ctx.params.platforms || [];
  const weekId = ctx.params.weekId || '';

  const books = results.map(r => (r && r.output) ? r.output : r).filter(Boolean);
  const lines = [];
  lines.push('# 网文榜单抓取报告 ' + weekId);
  lines.push('');
  lines.push('生成时间: ' + new Date().toISOString());
  lines.push('覆盖平台: ' + platforms.join(' / '));
  lines.push('共抓取: ' + books.length + ' 本');
  lines.push('');

  const byPlatform = {};
  for (const b of books) {
    const p = b.meta && b.meta.platform ? b.meta.platform : 'unknown';
    if (!byPlatform[p]) byPlatform[p] = [];
    byPlatform[p].push(b);
  }

  for (const p of Object.keys(byPlatform).sort()) {
    lines.push('## ' + p + ' (' + byPlatform[p].length + ' 本)');
    lines.push('');
    for (const b of byPlatform[p]) {
      const m = b.meta || {};
      lines.push('### ' + (m.title || '?') + ' / ' + (m.author || '?') + ' (rank ' + (m.rank || '?') + ')');
      lines.push('- url: ' + (m.url || ''));
      lines.push('- 标签: ' + (m.tags || []).join(', '));
      lines.push('- 简介: ' + (m.intro || '').slice(0, 200));
      lines.push('- 试读章: ' + (b.chapters || []).length + ' 章');
      lines.push('');
    }
  }

  const md = lines.join('\\n');
  const file = await ctx.saveArtifact(Buffer.from(md, 'utf8'), 'report-' + weekId + '.md');
  return { success: true, output: { markdown: md, savedTo: file, bookCount: books.length } };
`;

// ─── 节点构造 ──────────────────────────────────────────────────────────────

function platformParams(cfg: PlatformConfig) {
  return {
    platform: cfg.platform,
    humanName: cfg.humanName,
    baseUrl: cfg.baseUrl,
    rank: {
      url: cfg.rank.url,
      bookIdRegex: cfg.rank.bookIdRegex,
      extractScript: buildRankExtractScript(cfg.rank.selectors),
    },
    book: {
      urlTemplate: cfg.book.urlTemplate,
      freeStrategy: cfg.book.freeStrategy,
      extractScript: buildBookExtractScript(cfg.book.selectors),
      readerScript: buildReaderScript(cfg.book.reader),
    },
  };
}

function rankNodeId(p: PlatformKey): string {
  return `fetch_rankings_${p.replace(/[^a-z0-9]/gi, '_')}`;
}

function makeRankingsNode(
  cfg: PlatformConfig,
  runParams: NovelTropeRadarRunParams,
  agentPresetId: string,
): AgentNode {
  return {
    id: rankNodeId(cfg.platform),
    type: 'agent',
    input: {
      preset: agentPresetId,
      code: {
        strategy: 'code-only',
        script: RANKINGS_SCRIPT,
        params: { config: platformParams(cfg), topN: runParams.topN },
      },
      agentDef: {
        name: `抓 ${cfg.humanName} 榜单`,
        role: 'researcher',
        expertise: `${cfg.humanName} 飙升榜元数据采集`,
      },
    },
  };
}

function makeDedupNode(rankIds: string[], agentPresetId: string): AgentNode {
  return {
    id: 'dedup',
    type: 'agent',
    input: {
      preset: agentPresetId,
      code: {
        strategy: 'code-only',
        script: DEDUP_SCRIPT,
        params: {
          candidates: rankIds.map((id) => `steps.${id}.output.books`),
          knownBookKeys: [],
        },
      },
      agentDef: {
        name: '榜单去重合并',
        role: 'worker',
        expertise: '把多平台榜单按 bookKey 去重,过滤已抓取的书',
      },
    },
  };
}

function makeForEachBooksNode(maxIterations: number): ForEachNode {
  return {
    id: 'for_each_books',
    type: 'for-each',
    input: {
      collection: 'steps.dedup.output.fresh',
      itemVar: 'book',
      maxIterations,
    },
  };
}

function makeFetchDetailNode(
  runParams: NovelTropeRadarRunParams,
  agentPresetId: string,
): AgentNode {
  // 用 platform-configs 里 bookKey 前缀来路由 — 但 inline script 没有 import,
  // 所以把所有平台的 config 一起传进去,脚本按 book.platform 选。
  const configs: Record<string, ReturnType<typeof platformParams>> = {};
  for (const cfg of Object.values(ALL_PLATFORM_CONFIGS)) {
    configs[cfg.platform] = platformParams(cfg);
  }
  // 改写 script:从 configs 里取对应 platform
  const routedScript = `
    const platformCfgs = ctx.params.configs;
    const _book = ctx.params.book || {};
    ctx.params.book = _book;
    ctx.params.config = platformCfgs[_book.platform];
    if (!ctx.params.config) {
      return { success: false, output: null, error: '未知 platform: ' + _book.platform };
    }
    ctx.params.freeChapterLimit = ${runParams.freeChapterLimit};
    ctx.params.perBookDelayMs = ${runParams.perBookDelayMs};
    ${FETCH_DETAIL_SCRIPT}
  `;
  return {
    id: 'fetch_detail',
    type: 'agent',
    input: {
      preset: agentPresetId,
      code: {
        strategy: 'code-only',
        script: routedScript,
        params: { book: '{{ book }}', configs },
      },
      agentDef: {
        name: '抓单本详情',
        role: 'researcher',
        expertise: '按平台路由,抓取书籍简介/标签/章节目录/免费试读章',
      },
    },
  };
}

function makeAggregateNode(
  runParams: NovelTropeRadarRunParams,
  weekId: string,
  agentPresetId: string,
): AgentNode {
  return {
    id: 'aggregate',
    type: 'agent',
    input: {
      preset: agentPresetId,
      code: {
        strategy: 'code-only',
        script: AGGREGATE_SCRIPT,
        params: {
          results: 'steps.for_each_books.output.results',
          platforms: runParams.platforms,
          weekId,
        },
      },
      agentDef: {
        name: '汇总周报',
        role: 'worker',
        expertise: '把每本书的元数据 + 试读章拼成 markdown 报告并落盘',
      },
    },
  };
}

// ─── 公开:周 id + DSL builder ──────────────────────────────────────────────

export function currentWeekId(date: Date = new Date()): string {
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((target.getTime() - firstThursday.getTime()) / 86400000
      - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface BuildDslOptions {
  weekId?: string;
  /** Conversation agent preset id (templates.id where type='conversation').
   *  install 脚本会先确保 preset 存在再传进来。 */
  agentPresetId: string;
}

export function buildWorkflowDsl(
  runParams: NovelTropeRadarRunParams,
  options: BuildDslOptions,
): WorkflowDSLV3 {
  const weekId = options.weekId ?? currentWeekId();
  const agentPresetId = options.agentPresetId;
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  // Stage 1: rankings (parallel × N if N>=2)
  const rankIds: string[] = [];
  for (const p of runParams.platforms) {
    const cfg = ALL_PLATFORM_CONFIGS[p];
    if (!cfg) continue;
    const node = makeRankingsNode(cfg, runParams, agentPresetId);
    nodes.push(node);
    rankIds.push(node.id);
  }
  if (rankIds.length === 0) {
    throw new Error('runParams.platforms 没有任何已知平台');
  }

  let dedupEntry: string;
  if (rankIds.length >= 2) {
    const par: ParallelNode = {
      id: 'parallel_rankings',
      type: 'parallel',
      input: { onBranchFail: 'wait-all' },
    };
    const join: JoinNode = { id: 'join_rankings', type: 'join' };
    nodes.unshift(par);
    nodes.push(join);
    rankIds.forEach((id, i) => {
      edges.push({ from: par.id, to: id, kind: 'next', branchIndex: i });
      edges.push({ from: id, to: join.id, kind: 'next' });
    });
    dedupEntry = join.id;
  } else {
    dedupEntry = rankIds[0];
  }

  // Stage 2: dedup
  const dedup = makeDedupNode(rankIds, agentPresetId);
  nodes.push(dedup);
  edges.push({ from: dedupEntry, to: dedup.id, kind: 'next' });

  // Stage 3: for-each books
  const forEach = makeForEachBooksNode(runParams.topN * runParams.platforms.length);
  nodes.push(forEach);
  edges.push({ from: dedup.id, to: forEach.id, kind: 'next' });

  const fetchDetail = makeFetchDetailNode(runParams, agentPresetId);
  nodes.push(fetchDetail);
  edges.push({ from: forEach.id, to: fetchDetail.id, kind: 'body' });

  // Stage 4: aggregate (terminal)
  const aggregate = makeAggregateNode(runParams, weekId, agentPresetId);
  nodes.push(aggregate);
  edges.push({ from: forEach.id, to: aggregate.id, kind: 'next' });

  return {
    version: 'v3',
    name: '网文套路雷达',
    description:
      '抓取主流网文平台榜单 + 试读章 + 简介,产出 Markdown 报告与每本书 JSON 落盘。'
      + '每个节点都是 inline script,可在 DSL 里直接看代码。',
    nodes,
    edges,
    maxDurationMs: 4 * 60 * 60 * 1000,
  };
}
