/**
 * 周报 markdown 渲染
 *
 * 输入:WeeklyReport(diff 数据)。输出:markdown 文本。
 * 不包含原文片段,仅结构化分析结论。
 */

import type { WeeklyReport } from './types';

export function renderReportMarkdown(
  report: Omit<WeeklyReport, 'markdown'>,
): string {
  const lines: string[] = [];

  // 头部
  lines.push(`# 网文套路周报 ${report.weekId}`);
  lines.push('');
  lines.push(`> 生成时间: ${report.generatedAt}`);
  lines.push(`> 覆盖平台: ${report.platforms.join(' / ')}`);
  lines.push('');

  // 冒头
  lines.push('## 本周冒头');
  if (report.risingTropes.length === 0) {
    lines.push('_本周无明显冒头(阈值 ≥ 3 本)_');
  } else {
    lines.push('| 套路 tag | 本周 | 上周 | Δ |');
    lines.push('|---|---:|---:|---:|');
    for (const t of report.risingTropes) {
      const delta = t.thisWeek - t.lastWeek;
      lines.push(`| ${t.tag} | ${t.thisWeek} | ${t.lastWeek} | +${delta} |`);
    }
  }
  lines.push('');

  // 衰退
  lines.push('## 衰退中');
  if (report.decliningTropes.length === 0) {
    lines.push('_本周无明显衰退_');
  } else {
    lines.push('| 套路 tag | 本周 | 上周 | Δ |');
    lines.push('|---|---:|---:|---:|');
    for (const t of report.decliningTropes) {
      const delta = t.lastWeek - t.thisWeek;
      lines.push(`| ${t.tag} | ${t.thisWeek} | ${t.lastWeek} | -${delta} |`);
    }
  }
  lines.push('');

  // 新组合
  lines.push('## 新组合');
  if (report.newCombinations.length === 0) {
    lines.push('_本周无新出现的 tag 组合_');
  } else {
    for (const c of report.newCombinations) {
      lines.push(`- **${c.a} × ${c.b}** — 例: \`${c.examples.join('\` / \`')}\``);
    }
  }
  lines.push('');

  // 跨平台扩散
  lines.push('## 跨平台扩散');
  if (report.crossPlatformSpread.length === 0) {
    lines.push('_本周无跨平台扩散信号_');
  } else {
    for (const t of report.crossPlatformSpread) {
      lines.push(`- **${t.tag}** — 从 \`${t.from}\` 蔓延到 \`${t.to.join('/')}\``);
    }
  }
  lines.push('');

  // hook 归档
  lines.push('## 开篇 hook 模式归档');
  if (report.hookPatternArchive.length === 0) {
    lines.push('_无可归档 hook 模式_');
  } else {
    for (const h of report.hookPatternArchive) {
      lines.push(`- (${h.count} 本) ${h.pattern}`);
    }
  }
  lines.push('');

  // 尾注
  lines.push('---');
  lines.push('');
  lines.push('> 本周报由 novel-trope-radar workflow 自动生成。');
  lines.push('> 对应原文 corpus 已入 `novel-trope-corpus` collection,');
  lines.push('> 对话中可通过 RAG 检索具体写法。');

  return lines.join('\n');
}
