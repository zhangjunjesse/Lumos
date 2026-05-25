/**
 * X 雷达海报报告的 LLM 结构化输出 schema。
 * 让 LLM 不再吐 markdown，而是吐 {hook, kpis, insight, quotes, actions} —— poster 直接渲染。
 *
 * 设计：不加 z.string().max() 这种严格约束 — LLM 会因为撞墙整个字段 missing，
 * 反而让 schema 校验失败更难恢复。长度约束改靠 prompt + 渲染层适配。
 */

import { z } from 'zod';

export const ReportPosterSchema = z.object({
  hook: z.string().describe('一句话金句（≤30 字最佳），含具体数字 / 反差 / 时间对比'),
  kpis: z.array(z.object({
    value: z.string().describe('数字或短语（≤8 字符），如「10 亿」「+82%」「3 倍」'),
    label: z.string().describe('数字说明（≤10 字），如「Claude Code 半年 ARR」'),
  })).min(3).max(4),
  insight: z.string().describe('Markdown：## 起 2-4 个 section，每个 section 标题是一个观点判断'),
  quotes: z.array(z.object({
    text: z.string().describe('原推金句（≤60 字）'),
    author: z.string().describe('作者 handle 不带 @'),
    url: z.string().optional(),
  })).min(1).max(3),
  actions: z.array(z.string()).min(1).max(3),
});

export type ReportPosterData = z.infer<typeof ReportPosterSchema>;

/** 给 LLM 看的 example output —— 让它学顶层 5 字段的格式，避免吐 wrapper。 */
export const SCHEMA_EXAMPLE = `{
  "hook": "AI 编程工具半年破 10 亿 ARR，传统软件 30 年没干成",
  "kpis": [
    {"value": "10 亿", "label": "Claude Code 半年 ARR"},
    {"value": "+82%", "label": "周环比新增用户"},
    {"value": "30 年", "label": "传统 SaaS 同等规模耗时"}
  ],
  "insight": "## AI 编程工具开始挤压传统软件根基\\n\\nClaude Code 等 IDE 内 Agent 用半年走完了传统 IDE 30 年的路 [@author1](https://x.com/...)\\n\\n## GEO 接管 SEO 的临界点正在到来\\n\\n...",
  "quotes": [
    {"text": "Cursor 把我们整个团队的 ticket review 时间砍掉了 70%", "author": "user1", "url": "https://x.com/..."}
  ],
  "actions": [
    "用 Claude Code 接 Linear 自动 PR review，目标周省 5 小时",
    "在 GitHub Actions 接 narrator-ai 自动生成发布说明"
  ]
}`;
