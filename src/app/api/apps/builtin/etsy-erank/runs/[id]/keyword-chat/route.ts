import { NextRequest, NextResponse } from 'next/server';

import { getRun } from '@/lib/etsy-erank/runs';
import { loadScoreProvider } from '@/lib/etsy-erank/scorer';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatBody {
  keywords: string[];        // 用户附加的 keyword 列表(可空 = 通用提问)
  messages: ChatMessage[];   // 完整对话历史
  providerId?: string;       // 用户选择的 provider id(覆盖默认)
  model?: string;            // 用户选择的 model(覆盖 catalog 偏好)
}

interface AnalysisShape {
  sales?: { max?: number; median?: number; total?: number; top10?: number[] };
  favorites?: { max?: number; median?: number; total?: number };
  price?: { min?: number; max?: number; median?: number; p25?: number; p75?: number };
  newStores?: { within30?: number; within30WithSales?: number };
  top5SalesPct?: number;
  topShops?: Array<{ name: string; sales: number; listings: number }>;
  topNgrams?: Array<{ gram: string; count: number }>;
  llmInsight?: string;
}

interface KeywordContext {
  keyword: string;
  bulkMetric: { searches: string; competition: string; kd: string; ctr: string; grade: string } | null;
  analysis: AnalysisShape | null;
  topListings: Array<{ title: string; price: string; shop_name: string; ehunt?: Record<string, unknown> }>;
  scoredCandidate: { productGuess?: string; rationale?: string; nextStep?: string } | null;
}

function loadKeywordContext(runId: string, keyword: string): KeywordContext {
  const db = getDb();
  const bulkRow = db.prepare(`SELECT searches, competition, kd, ctr, grade FROM radar_bulk WHERE run_id = ? AND keyword = ?`).get(runId, keyword) as { searches: string; competition: string; kd: string; ctr: string; grade: string } | undefined;
  const ehuntRow = db.prepare(`SELECT analysis_json, listings_json FROM radar_ehunt WHERE run_id = ? AND keyword = ?`).get(runId, keyword) as { analysis_json: string; listings_json: string } | undefined;
  const analysis = ehuntRow ? JSON.parse(ehuntRow.analysis_json) as AnalysisShape : null;
  const listings = ehuntRow ? JSON.parse(ehuntRow.listings_json) as Array<{ title: string; price: string; shop_name: string; ehunt?: Record<string, unknown> }> : [];

  let scoredCandidate: { productGuess?: string; rationale?: string; nextStep?: string } | null = null;
  const scoredRows = db.prepare(`SELECT candidates_json FROM radar_scored_niches WHERE run_id = ?`).all(runId) as Array<{ candidates_json: string }>;
  for (const sr of scoredRows) {
    const cands = JSON.parse(sr.candidates_json) as Array<{ keyword: string; productGuess?: string; rationale?: string; nextStep?: string }>;
    const found = cands.find((c) => c.keyword === keyword);
    if (found) { scoredCandidate = found; break; }
  }

  return { keyword, bulkMetric: bulkRow ?? null, analysis, topListings: listings, scoredCandidate };
}

function formatKeywordContext(ctx: KeywordContext): string {
  const lines: string[] = [`---`, `## 关键词:${ctx.keyword}`];
  if (ctx.bulkMetric) {
    lines.push(`④ 验真: 月搜 ${ctx.bulkMetric.searches} · 竞争 ${ctx.bulkMetric.competition} · KD ${ctx.bulkMetric.kd} · CTR ${ctx.bulkMetric.ctr} · grade ${ctx.bulkMetric.grade}`);
  } else {
    lines.push(`④ 验真: 数据缺失`);
  }
  if (ctx.scoredCandidate) {
    lines.push(`⑤ AI 解读: ${ctx.scoredCandidate.productGuess ?? ''} · ${ctx.scoredCandidate.rationale ?? ''} · 下一步 ${ctx.scoredCandidate.nextStep ?? ''}`);
  }
  if (ctx.analysis) {
    const a = ctx.analysis;
    lines.push(`⑥ EHunt 商业分析:`);
    lines.push(`  · 销量 顶/中位 ${a.sales?.max ?? '?'}/${a.sales?.median ?? '?'} · top10 合计 ${a.sales?.top10?.reduce((s, x) => s + x, 0) ?? '?'}`);
    lines.push(`  · 收藏 顶/中位 ${a.favorites?.max ?? '?'}/${a.favorites?.median ?? '?'}`);
    lines.push(`  · 价格 $${a.price?.min ?? '?'}-${a.price?.max ?? '?'} · 中位 $${a.price?.median ?? '?'} · P25-P75 $${a.price?.p25 ?? '?'}-$${a.price?.p75 ?? '?'}`);
    lines.push(`  · 新店(≤30 天) ${a.newStores?.within30 ?? '?'} 个 · 已出单 ${a.newStores?.within30WithSales ?? '?'}`);
    lines.push(`  · 头部 5 店占销 ${a.top5SalesPct != null ? Math.round(a.top5SalesPct * 100) : '?'}%`);
    lines.push(`  · 头部店铺: ${(a.topShops ?? []).slice(0, 5).map((s) => `${s.name}(销 ${s.sales})`).join(', ')}`);
    lines.push(`  · 头部 SEO 词: ${(a.topNgrams ?? []).slice(0, 10).map((n) => n.gram).join(' / ')}`);
    if (a.llmInsight) lines.push(`  · LLM 一句话: ${a.llmInsight}`);
  }
  if (ctx.topListings.length > 0) {
    lines.push(`头部 listing(前 6 个):`);
    ctx.topListings.slice(0, 6).forEach((l, i) => {
      const eh = l.ehunt as { sales?: number; favorites?: number; listed_date?: string } | undefined;
      lines.push(`  ${i + 1}. ${l.title.slice(0, 80)} · ${l.price} · ${l.shop_name}` + (eh ? ` · 销 ${eh.sales ?? '?'} · 收 ${eh.favorites ?? '?'} · 上架 ${eh.listed_date ?? '?'}` : ''));
    });
  }
  return lines.join('\n');
}

function buildSystemPrompt(args: { runLabel: string; capabilities: string[]; contexts: KeywordContext[] }): string {
  const userDir = args.capabilities.length > 0 ? `用户能力清单: ${args.capabilities.join(' / ')}` : '用户没填能力(blank_slate)';

  const ctxBlock = args.contexts.length === 0
    ? '(用户没附加任何关键词,只是通用提问)'
    : args.contexts.map(formatKeywordContext).join('\n\n');

  const focus = args.contexts.length === 0
    ? '通用提问 — 帮用户理解 Etsy 选品方法论 / 数据指标 / 流程。'
    : args.contexts.length === 1
      ? `单关键词聊 — 帮用户理解这关键词的文化 / IP / 受众 / 产品形态 / 切入策略。`
      : `多关键词对比 — 用户附加了 ${args.contexts.length} 个关键词,帮他横向比较优劣、定优先级、找差异化角度。`;

  return `你是 Etsy 选品助手,正在和卖家讨论。

# 轮次
${args.runLabel} · ${userDir}

# 已附加的关键词上下文

${ctxBlock}

# 你的任务

${focus}

卖家不熟悉这些关键词的文化、背景、IP、目标买家。你的任务: 帮他理解,以及实操切入(产品、SEO、定价、风险)。

# 输出风格

- 中文回答,平实口语,不写黑话不堆术语。
- 一次回答聚焦一个角度,避免大段堆砌。
- 引用具体数字直接用上面的真数据,不要编。
- 小众 IP 一定提醒查授权,建议自己上网验证。
- 不懂就说不懂,不知道就说不知道。
- 多关键词对比时,用清晰的"keyword: ..."结构对比,不要混在一起讲。`;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Partial<ChatBody>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }
  if (body.messages[body.messages.length - 1]?.role !== 'user') {
    return NextResponse.json({ error: 'last message must be user' }, { status: 400 });
  }
  const keywords = Array.isArray(body.keywords) ? body.keywords.filter((k) => typeof k === 'string' && k.trim()) : [];

  let provider;
  try {
    provider = loadScoreProvider({ providerId: body.providerId, model: body.model });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }

  // 加载所有附加 keyword 的上下文
  const contexts = keywords.slice(0, 10).map((k) => loadKeywordContext(id, k));

  const system = buildSystemPrompt({
    runLabel: run.label,
    capabilities: run.capabilities,
    contexts,
  });

  // 流式响应:走 Anthropic stream=true,把 SSE 转成简单 text/event-stream 给前端
  try {
    const upstream = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 2048,
        system,
        messages: body.messages,
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok || !upstream.body) {
      const text = (await upstream.text()).slice(0, 300);
      return NextResponse.json({ error: `HTTP ${upstream.status}: ${text}` }, { status: 502 });
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data) continue;
              try {
                const ev = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
                if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
                  // 推送给前端:每个 chunk 一行 data: <json>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: ev.delta.text })}\n\n`));
                } else if (ev.type === 'message_stop') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
                }
              } catch {
                // 忽略 parse 失败的行(可能是 event: 行)
              }
            }
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
