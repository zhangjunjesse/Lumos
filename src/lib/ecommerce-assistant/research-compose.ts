import type { ResearchSourceResult } from './research-sources';

export interface ComposeReportArgs {
  platform: string;
  query: string;
  instruction: string | null;
  sourceResults: ResearchSourceResult[];
  generatedAt?: string;
  /** Optional LLM-produced analysis prepended above the raw source dump. */
  analysis?: ResearchAnalysis | null;
}

export interface ResearchAnalysis {
  executive_summary: string;
  key_findings: string[];
  competitive_landscape?: string;
  pricing_observations?: string;
  recommended_actions: string[];
}

export interface ComposedReport {
  markdown: string;
  summary: string;
}

/**
 * Compose a markdown research report from collected source results.
 *
 * MVP: deterministic template assembly so the runner can land end-to-end
 * even when the LLM client / external data sources are unavailable. Real
 * polish point is to swap this for `generateStructured` from llm-client.
 */
export function composeResearchReport(args: ComposeReportArgs): ComposedReport {
  const ts = args.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];
  const title = `${args.platform} 调研报告：${args.query}`;
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> 生成时间：${ts}`);
  lines.push(`> 平台：\`${args.platform}\``);
  if (args.instruction) {
    lines.push(`> 用户指令：${args.instruction}`);
  }
  lines.push('');

  // Executive summary section
  lines.push('## 总览摘要');
  const successSources = args.sourceResults.filter((r) => r.ok);
  const failedSources = args.sourceResults.filter((r) => !r.ok);
  const totalItems = successSources.reduce((sum, r) => sum + r.items.length, 0);
  lines.push(`- 数据源使用：${args.sourceResults.length} 个（成功 ${successSources.length} / 失败 ${failedSources.length}）`);
  lines.push(`- 汇总条目：${totalItems} 条`);
  if (failedSources.length > 0) {
    lines.push(`- 失败数据源：${failedSources.map((r) => `\`${r.source}\``).join('、')}`);
  }
  lines.push('');

  // LLM-driven analysis sections (when available).
  if (args.analysis) {
    const a = args.analysis;
    lines.push('## AI 洞察');
    lines.push(a.executive_summary);
    lines.push('');
    if (a.key_findings.length > 0) {
      lines.push('### 关键发现');
      a.key_findings.forEach((f) => lines.push(`- ${f}`));
      lines.push('');
    }
    if (a.competitive_landscape) {
      lines.push('### 竞争格局');
      lines.push(a.competitive_landscape);
      lines.push('');
    }
    if (a.pricing_observations) {
      lines.push('### 价格观察');
      lines.push(a.pricing_observations);
      lines.push('');
    }
    if (a.recommended_actions.length > 0) {
      lines.push('### 推荐动作');
      a.recommended_actions.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
      lines.push('');
    }
  }

  // Per-source detail
  for (const r of args.sourceResults) {
    lines.push(`## 数据源：${r.source}`);
    if (!r.ok) {
      lines.push(`- 状态：❌ 失败（${r.error ?? '未知原因'}）`);
      lines.push('');
      continue;
    }
    lines.push(`- 状态：✅ 成功${typeof r.latency_ms === 'number' ? ` · 耗时 ${r.latency_ms}ms` : ''}`);
    lines.push(`- 条目：${r.items.length}`);
    lines.push('');
    if (r.items.length > 0) {
      r.items.slice(0, 20).forEach((item, idx) => {
        lines.push(`${idx + 1}. **${escapeMd(item.title)}**${item.url ? ` — [${item.url}](${item.url})` : ''}`);
        if (item.snippet) lines.push(`   - ${escapeMd(item.snippet)}`);
        if (typeof item.score === 'number') lines.push(`   - 分数：${item.score}`);
      });
      if (r.items.length > 20) {
        lines.push(`_…还有 ${r.items.length - 20} 条未展示_`);
      }
      lines.push('');
    }
  }

  // Closing actions
  lines.push('## 行动建议');
  if (totalItems === 0) {
    lines.push('- 当前所有数据源均无有效条目。建议：1）检查所选平台 / 关键词；2）在「设置 → 浏览器」配置 AdsPower / 内置浏览器；3）注册更精确的 source adapter。');
  } else {
    lines.push('- 基于以上来源，下一步可：');
    lines.push('  1. 在「选品」里把高分条目导入候选；');
    lines.push('  2. 在「工坊」按选品出图；');
    lines.push('  3. 在「上架」生成 listing 文案。');
  }
  lines.push('');

  const markdown = lines.join('\n');
  const summary = buildSummary(args.platform, args.query, totalItems, successSources.length, failedSources.length);
  return { markdown, summary };
}

function buildSummary(
  platform: string,
  query: string,
  totalItems: number,
  okCount: number,
  failCount: number,
): string {
  return `${platform} · ${query} · ${okCount}/${okCount + failCount} 源 · ${totalItems} 条`;
}

function escapeMd(text: string): string {
  return String(text).replace(/[\\`*_]/g, (m) => `\\${m}`);
}
