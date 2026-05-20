import { isDataItem, type ResearchSourceResult } from './research-sources';

export interface ComposeReportArgs {
  platform: string;
  query: string;
  instruction: string | null;
  sourceResults: ResearchSourceResult[];
  generatedAt?: string;
  /** Optional LLM-produced analysis prepended above the raw source dump. */
  analysis?: ResearchAnalysis | null;
  /**
   * 当 AI 洞察未生成时的可见原因（未配置模型 / 分析超时 / schema 失败）。
   * 有 analysis 时忽略；无 analysis 但有此值时如实展示，禁止静默省略。
   */
  analyzeError?: string | null;
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
  // 只计真实数据条目；notice（空态/引导/错误解释）不算数据，杜绝
  // 「web 全失败却报 N 条」这类把占位当数据的脏摘要。
  const dataItemsBySource = (r: ResearchSourceResult) =>
    r.ok ? r.items.filter(isDataItem) : [];
  const totalItems = successSources.reduce(
    (sum, r) => sum + dataItemsBySource(r).length,
    0,
  );
  lines.push(`- 数据源使用：${args.sourceResults.length} 个（成功 ${successSources.length} / 失败 ${failedSources.length}）`);
  lines.push(`- 汇总条目：${totalItems} 条（仅真实数据，提示信息不计）`);
  if (failedSources.length > 0) {
    lines.push(`- 失败数据源：${failedSources.map((r) => `\`${r.source}\``).join('、')}`);
  }
  if (totalItems === 0) {
    lines.push('- ⚠️ 本次未采集到任何真实数据，下方各数据源仅为失败原因或提示，不能作为选品依据。');
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
  } else if (args.analyzeError) {
    // 没有 analysis 但分析环节出过状况：如实写出原因，不静默省略整段。
    lines.push('## AI 洞察');
    lines.push(`> ⚠️ ${args.analyzeError}`);
    lines.push('');
  }

  // Per-source detail
  for (const r of args.sourceResults) {
    lines.push(`## 数据源：${r.source}`);
    if (!r.ok) {
      lines.push(`- 状态：❌ 失败（${r.error ?? '未知原因'}）`);
      lines.push('');
      continue;
    }
    const dataItems = r.items.filter(isDataItem);
    const noticeItems = r.items.filter((it) => !isDataItem(it));
    lines.push(`- 状态：✅ 成功${typeof r.latency_ms === 'number' ? ` · 耗时 ${r.latency_ms}ms` : ''}`);
    lines.push(`- 数据条目：${dataItems.length}${noticeItems.length > 0 ? ` · 提示：${noticeItems.length}` : ''}`);
    lines.push('');
    if (dataItems.length > 0) {
      dataItems.slice(0, 20).forEach((item, idx) => {
        lines.push(`${idx + 1}. **${escapeMd(item.title)}**${item.url ? ` — [${item.url}](${item.url})` : ''}`);
        if (item.snippet) lines.push(`   - ${escapeMd(item.snippet)}`);
        if (typeof item.score === 'number') lines.push(`   - 分数：${item.score}`);
      });
      if (dataItems.length > 20) {
        lines.push(`_…还有 ${dataItems.length - 20} 条未展示_`);
      }
      lines.push('');
    }
    if (noticeItems.length > 0) {
      // 提示不是数据：单列、不编号、明确标注，绝不与数据混排冒充结果。
      lines.push('> ℹ️ 提示（非数据）：');
      noticeItems.forEach((item) => {
        lines.push(`> - ${escapeMd(item.title)}${item.snippet ? `：${escapeMd(item.snippet)}` : ''}`);
      });
      lines.push('');
    }
    if (dataItems.length === 0 && noticeItems.length === 0) {
      lines.push('- （无数据条目）');
      lines.push('');
    }
  }

  // Closing actions
  lines.push('## 行动建议');
  if (totalItems === 0) {
    lines.push('- ⚠️ 本次零真实数据，**不能用于选品决策**。排查顺序：1）确认 Lumos 桌面端浏览器运行时已启动（Browser Bridge 连接）；2）检查所选平台 / 关键词是否受支持；3）在「设置 → 浏览器」配置 AdsPower / 内置浏览器；4）修复后点「重新跑」。');
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
