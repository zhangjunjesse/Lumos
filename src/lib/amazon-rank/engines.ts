import type { AppDataStore } from '@/lib/app/runtime/data-store';

import {
  buildSearchUrl,
  classifySignals,
  parseExtractSignals,
  OUTER_HTML_SCRIPT,
} from './amazon-page';
import { proposeRulesWithAi, readPageWithAi, type StructuredGenerate } from './ai-operator';
import type { RankBrowserSession } from './browser-session';
import { MAX_RULE_PROPOSALS_PER_RUN, MIN_RULE_AGREEMENT, TOP_N } from './constants';
import {
  buildExtractSignalsScript,
  saveDraftRules,
  type ActiveRulesInfo,
  type ExtractionRuleSet,
} from './extraction-rules';
import { PAGE_DIGEST_SCRIPT, parsePageDigest, type PageDigest } from './page-digest';
import { openRepairTicket } from './repair-tickets';
import type { RankMatch, RankResultRow, RankSettings } from './types';

/**
 * 双查询引擎。主循环（runner）模式无关，只调 queryOne / finalize：
 * - 代码引擎：当前生效规则生成的页内脚本，解析失败落修复工单
 * - AI 引擎：页面摘要 → 大模型识别自然位；同页顺带验证代码规则，
 *   失效则让 AI 提案新规则并在后续关键词的真实页面上持续验证，
 *   验证达标后 finalize 落草稿（用户确认才生效）
 */

export interface KeywordOutcome {
  status: 'ok' | 'no_results' | 'blocked' | 'parse_failed' | 'failed';
  topAsins?: string[];
  matches?: RankMatch[];
  organicCount?: number;
  snapshotPath?: string;
  errorMessage?: string;
}

export interface QueryEngine {
  queryOne(row: RankResultRow, targetAsins: string[]): Promise<KeywordOutcome>;
  /**
   * 运行收尾（正常/中止都会调）：AI 引擎在此保存规则草稿。
   * 返回给用户看的修复轨道说明（写进 run 记录展示），无事发生返回 null。
   */
  finalize(): string | null;
}

export interface EngineContext {
  session: RankBrowserSession;
  settings: RankSettings;
  store: AppDataStore;
  runId: string;
  saveSnapshot: (runId: string, seq: number, keyword: string, html: string) => string | undefined;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export function matchAsins(topAsins: string[], targetAsins: string[]): RankMatch[] {
  const matches: RankMatch[] = [];
  for (const asin of targetAsins) {
    const index = topAsins.indexOf(asin);
    if (index !== -1) matches.push({ asin, rank: index + 1 });
  }
  return matches;
}

/** 共用的导航 + 等待 + 快照落盘 */
async function navigateAndSnapshot(ctx: EngineContext, row: RankResultRow): Promise<string | undefined> {
  await ctx.session.api.navigate(buildSearchUrl(ctx.settings.site, row.keyword));
  try {
    await ctx.session.api.waitFor(['results', 'No results', 'did not match'], { timeout: 30_000 });
  } catch {
    await ctx.sleep(5_000);
  }
  await ctx.sleep(3_000);
  try {
    const html = await ctx.session.api.evaluate<string>(OUTER_HTML_SCRIPT);
    return ctx.saveSnapshot(ctx.runId, row.seq, row.keyword, typeof html === 'string' ? html : '');
  } catch {
    return undefined;
  }
}

export function createCodeEngine(ctx: EngineContext, active: ActiveRulesInfo): QueryEngine {
  const script = buildExtractSignalsScript(active.rules);
  return {
    async queryOne(row, targetAsins) {
      try {
        const snapshotPath = await navigateAndSnapshot(ctx, row);
        const raw = await ctx.session.api.evaluate<string>(script);
        const signals = parseExtractSignals(raw);
        const classified = classifySignals(signals);
        if (classified.status !== 'ok') {
          if (classified.status === 'parse_failed') {
            openRepairTicket(ctx.store, {
              runId: ctx.runId,
              seq: row.seq,
              keyword: row.keyword,
              reason: classified.message ?? '页面解析失败',
              snapshotPath,
            });
          }
          return {
            status: classified.status,
            topAsins: signals?.organicAsins ?? [],
            organicCount: signals?.organicAsins.length ?? 0,
            snapshotPath,
            errorMessage: classified.message,
          };
        }
        const topAsins = (signals?.organicAsins ?? []).map((a) => a.toUpperCase());
        return {
          status: 'ok',
          topAsins,
          matches: matchAsins(topAsins, targetAsins),
          organicCount: topAsins.length,
          snapshotPath,
        };
      } catch (error) {
        return { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error) };
      }
    },
    finalize() {
      return null;
    },
  };
}

interface RuleCandidate {
  rules: ExtractionRuleSet;
  script: string;
  rationale: string;
  /** 在这些关键词的真实页面上与 AI 结果完全一致 */
  validatedKeywords: string[];
}

export function createAiEngine(
  ctx: EngineContext,
  active: ActiveRulesInfo,
  generate: StructuredGenerate,
): QueryEngine {
  const activeScript = buildExtractSignalsScript(active.rules);
  let candidate: RuleCandidate | null = null;
  let proposalsUsed = 0;
  let activeRuleFailures = 0;

  async function runRulesScript(script: string): Promise<string[]> {
    const raw = await ctx.session.api.evaluate<string>(script);
    return parseExtractSignals(raw)?.organicAsins.map((a) => a.toUpperCase()) ?? [];
  }

  /** 修复轨道：尽力而为，任何失败都不影响本词查询结果 */
  async function trackRepair(keyword: string, digest: PageDigest, expected: string[]): Promise<void> {
    try {
      const activeAsins = await runRulesScript(activeScript);
      if (arraysEqual(activeAsins, expected)) return; // 现役规则在本页健康，无需修复
      activeRuleFailures++;
      if (candidate) {
        if (arraysEqual(await runRulesScript(candidate.script), expected)) {
          candidate.validatedKeywords.push(keyword);
        } else {
          candidate = null; // 候选在新页面上失效，作废（后续关键词可再提案）
        }
        return;
      }
      if (proposalsUsed >= MAX_RULE_PROPOSALS_PER_RUN) return;
      proposalsUsed++;
      const proposal = await proposeRulesWithAi(generate, digest, expected, active.rules, ctx.signal);
      const script = buildExtractSignalsScript(proposal.rules);
      if (arraysEqual(await runRulesScript(script), expected)) {
        candidate = { rules: proposal.rules, script, rationale: proposal.rationale, validatedKeywords: [keyword] };
      }
    } catch {
      /* 修复是附带任务，静默放弃这一页 */
    }
  }

  return {
    async queryOne(row, targetAsins) {
      try {
        const snapshotPath = await navigateAndSnapshot(ctx, row);
        const digest = parsePageDigest(
          await ctx.session.api.evaluate<string>(PAGE_DIGEST_SCRIPT).catch(() => ''),
        );
        if (!digest) {
          return { status: 'parse_failed', snapshotPath, errorMessage: '页面摘要脚本没有返回数据（页面可能未加载完成）' };
        }
        const read = await readPageWithAi(
          generate, ctx.settings.aiOperatorPrompt, digest, TOP_N, ctx.signal,
        );
        if (read.captcha) {
          return { status: 'blocked', snapshotPath, errorMessage: 'AI 判定页面为验证码（Robot Check），疑似触发风控' };
        }
        if (read.organicAsins.length === 0) {
          return read.noResults
            ? { status: 'no_results', snapshotPath, errorMessage: '亚马逊提示没有匹配的商品' }
            : { status: 'parse_failed', snapshotPath, errorMessage: 'AI 也未能从页面识别出自然位' };
        }
        await trackRepair(row.keyword, digest, read.organicAsins);
        return {
          status: 'ok',
          topAsins: read.organicAsins,
          matches: matchAsins(read.organicAsins, targetAsins),
          organicCount: read.organicAsins.length,
          snapshotPath,
        };
      } catch (error) {
        return { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error) };
      }
    },
    finalize() {
      if (candidate && candidate.validatedKeywords.length >= MIN_RULE_AGREEMENT) {
        const saved = saveDraftRules(ctx.store, candidate.rules, {
          note: candidate.rationale,
          validatedKeywords: candidate.validatedKeywords,
        });
        return (
          `代码解析规则在本次运行中失效，AI 已生成修复草稿 v${saved.version}` +
          `（在 ${candidate.validatedKeywords.length} 个关键词的真实页面上验证一致）。` +
          '到「设置 → 页面解析规则」确认采用后，代码引擎即可恢复。'
        );
      }
      if (activeRuleFailures > 0) {
        return (
          `代码解析规则在 ${activeRuleFailures} 个关键词页面上失效，` +
          'AI 的修复候选未能通过页面验证，本次未生成草稿；可多跑几个关键词再试。'
        );
      }
      return null;
    },
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
