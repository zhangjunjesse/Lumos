/**
 * X 雷达海报渲染辅助：markdown 解析 + KPI 字号自适应。
 * 拆出来让 report-poster-blocks.ts 保持在 300 行内。
 */

export type InsightBlock =
  | { kind: 'h'; level: 2 | 3; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'blank' };

export function parseSimpleMarkdown(md: string): InsightBlock[] {
  const out: InsightBlock[] = [];
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line === '') { out.push({ kind: 'blank' }); continue; }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) { out.push({ kind: 'h', level: 3, text: stripInline(h3[1]) }); continue; }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) { out.push({ kind: 'h', level: 2, text: stripInline(h2[1]) }); continue; }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li) { out.push({ kind: 'list', text: stripInline(li[1]) }); continue; }
    out.push({ kind: 'p', text: stripInline(line) });
  }
  return out;
}

export function stripInline(t: string): string {
  return t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

/** KPI value 字号自适应：根据视觉长度（中文 1.0 / 数字 0.55）+ 列数选字号。
 * v13 调小 base 字号 ~30% — 之前 120/96 在真实渲染撑满卡片，太 dashboard 风；
 * magazine 海报感要 KPI 让位给 hook，数字有信息密度即可，不必撑满。 */
export function kpiValueFontSize(value: string, cols: number): number {
  const visualLen = [...value].reduce((acc, ch) => acc + (/[一-鿿]/.test(ch) ? 1 : 0.55), 0);
  const table = cols === 3
    ? { 3: 64, 4: 52, 5: 44, 6: 38, 7: 32, 8: 28, more: 26 }
    : { 3: 88, 4: 72, 5: 60, 6: 50, 7: 42, 8: 36, more: 32 };
  if (visualLen <= 3) return table[3];
  if (visualLen <= 4) return table[4];
  if (visualLen <= 5) return table[5];
  if (visualLen <= 6) return table[6];
  if (visualLen <= 7) return table[7];
  if (visualLen <= 8) return table[8];
  return table.more;
}
