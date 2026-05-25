/**
 * LLM 输出的容错解析：
 * - 剥 wrapper（LLM 喜欢自作主张包 {summaries:[{...}]}、{data:{...}}、{result:{...}}）
 * - 字段类型适配（LLM 把 kpis 吐成 ["10 亿 ARR", ...] 字符串数组，把 quotes 吐成字符串数组）
 * - JSON 截断时尝试补全（找最后一个 balanced object）
 *
 * 真实场景：sonnet 在 23K 字符 prompt + maxTokens 3000 下，会吐 wrapped JSON 并按账号分组，
 * 导致严格 schema 全部 5 字段 undefined。此文件做兜底。
 */

import { ReportPosterSchema, type ReportPosterData } from './report-schema';

const ROOT_WRAPPERS = ['summaries', 'summary', 'data', 'result', 'response', 'report', 'accounts'];

/** 尝试用容错方式从 LLM 原文中解析出 ReportPosterData。 */
export function tolerantParseReport(rawText: string): { ok: true; data: ReportPosterData } | { ok: false; reason: string; rawHead: string } {
  const head = rawText.slice(0, 600);
  const jsonText = extractJsonText(rawText);
  if (!jsonText) return { ok: false, reason: '未找到 JSON 对象', rawHead: head };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // 截断：尝试找最后一个 balanced JSON object（去掉末尾乱码）
    const repaired = repairTruncatedJson(jsonText);
    if (!repaired) return { ok: false, reason: 'JSON 截断且无法修复', rawHead: head };
    try { parsed = JSON.parse(repaired); }
    catch (err) { return { ok: false, reason: `JSON 解析失败：${err instanceof Error ? err.message : ''}`, rawHead: head }; }
  }

  const unwrapped = unwrapToReportShape(parsed);
  const coerced = coerceFields(unwrapped);
  const validated = ReportPosterSchema.safeParse(coerced);
  if (validated.success) return { ok: true, data: validated.data };
  return { ok: false, reason: `Schema 校验失败：${formatZodIssues(validated.error)}`, rawHead: head };
}

function extractJsonText(text: string): string | null {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced?.startsWith('{')) return fenced;
  if (t.startsWith('{')) return t;
  const idx = t.indexOf('{');
  return idx >= 0 ? t.slice(idx) : null;
}

/** 截断的 JSON：从末尾倒退，找到最后一个 balanced 位置。 */
function repairTruncatedJson(text: string): string | null {
  let depth = 0, inStr = false, esc = false, lastBalanced = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) lastBalanced = i; }
  }
  return lastBalanced > 0 ? text.slice(0, lastBalanced + 1) : null;
}

/** 剥外层 wrapper：{summaries:[{hook,...}]} → {hook,...}。 */
function unwrapToReportShape(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  let cur = input as Record<string, unknown>;
  for (let depth = 0; depth < 4; depth++) {
    if (hasReportFields(cur)) return cur;
    let unwrapped: Record<string, unknown> | null = null;
    for (const key of ROOT_WRAPPERS) {
      const v = cur[key];
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
        unwrapped = v[0] as Record<string, unknown>; break;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        unwrapped = v as Record<string, unknown>; break;
      }
    }
    if (!unwrapped) break;
    cur = unwrapped;
  }
  return cur;
}

function hasReportFields(obj: Record<string, unknown>): boolean {
  return ('hook' in obj || 'kpis' in obj) && ('insight' in obj || 'insights' in obj);
}

/** 字段类型容错：LLM 吐错类型时尽量适配。 */
function coerceFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  // insight / insights：LLM 复数 + 对象数组 [{title, detail}] → 拼成 markdown
  if (!out.insight && Array.isArray(out.insights)) {
    out.insight = (out.insights as unknown[]).map((s) => {
      if (typeof s === 'string') return s;
      if (s && typeof s === 'object') {
        const o = s as Record<string, unknown>;
        const title = String(o.title ?? o.heading ?? o.name ?? '');
        const detail = String(o.detail ?? o.body ?? o.content ?? o.text ?? '');
        return title ? `## ${title}\n\n${detail}` : detail;
      }
      return '';
    }).filter(Boolean).join('\n\n');
  }
  // kpis：字符串数组 → 用空格/全角冒号/破折号切 value/label
  if (Array.isArray(out.kpis)) {
    out.kpis = (out.kpis as unknown[]).map((k) => {
      if (typeof k === 'string') return splitKpiString(k);
      if (k && typeof k === 'object') {
        const o = k as Record<string, unknown>;
        return {
          value: String(o.value ?? o.number ?? o.metric ?? o.figure ?? ''),
          label: String(o.label ?? o.description ?? o.desc ?? o.name ?? ''),
        };
      }
      return { value: '', label: '' };
    }).filter((k: { value: string }) => k.value);
  }
  // quotes：字符串数组 → 包成 {text}
  if (Array.isArray(out.quotes)) {
    out.quotes = (out.quotes as unknown[]).map((q) => {
      if (typeof q === 'string') return { text: q, author: '' };
      if (q && typeof q === 'object') {
        const o = q as Record<string, unknown>;
        return {
          text: String(o.text ?? o.quote ?? o.content ?? ''),
          author: String(o.author ?? o.handle ?? o.from ?? ''),
          url: o.url ? String(o.url) : undefined,
        };
      }
      return { text: '', author: '' };
    }).filter((q: { text: string }) => q.text);
  }
  // actions：对象数组 [{tool, action, expected}] → 字符串「工具：动作 → 预期」
  if (Array.isArray(out.actions)) {
    out.actions = (out.actions as unknown[]).map((a) => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object') {
        const o = a as Record<string, unknown>;
        const tool = o.tool ?? o.name;
        const action = o.action ?? o.step ?? o.text;
        const expected = o.expected ?? o.outcome ?? o.result;
        const parts = [tool, action, expected].filter(Boolean).map(String);
        return parts.length === 3 ? `${parts[0]}：${parts[1]} → ${parts[2]}` : parts.join(' ');
      }
      return '';
    }).filter(Boolean);
  }
  return out;
}

function splitKpiString(s: string): { value: string; label: string } {
  // 「10 亿 Claude Code 半年 ARR」 / 「10 亿：Claude Code ARR」 / 「10 亿 - Claude Code」
  const sep = s.match(/^([^\s—\-:：]+)\s*[—\-:：]\s*(.+)$/) ?? s.match(/^(\S+(?:\s\S{1,2})?)\s+(.+)$/);
  if (sep) return { value: sep[1].trim(), label: sep[2].trim() };
  return { value: s.slice(0, 8), label: s.slice(8).trim() || s };
}

function formatZodIssues(err: { issues?: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issues = err.issues ?? [];
  return issues.slice(0, 3).map((i) => `${i.path.map(String).join('.')}：${i.message}`).join('；');
}
