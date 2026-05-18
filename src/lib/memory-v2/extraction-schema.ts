import { z } from 'zod';

// memory-v2 自动提炼的「契约」：抽取/对账的 JSON schema 与系统提示词。
// 与编排逻辑（extraction.ts）分开，便于单独审阅盐度规则。

export const FACT_KINDS = ['task', 'people', 'resource', 'capability'] as const;

export const factSchema = z.object({
  kind: z.enum(FACT_KINDS),
  scope: z.enum(['user', 'project', 'session']),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(2000),
  importance: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
});
export type ExtractedFact = z.infer<typeof factSchema>;

export const extractionSchema = z.object({ facts: z.array(factSchema).max(12) });

export const decisionSchema = z.object({
  decisions: z.array(z.object({
    factIndex: z.number().int().min(0),
    op: z.enum(['ADD', 'UPDATE', 'NOOP', 'DELETE']),
    targetId: z.string().trim().optional(),
    title: z.string().trim().max(120).optional(),
    body: z.string().trim().max(2000).optional(),
  })),
});
export type ReconcileDecisions = z.infer<typeof decisionSchema>['decisions'];

export const EXTRACT_SYSTEM = [
  '你是 Lumos 的行动记忆提炼器。只从对话里提炼对未来工作真正有用、且会持续成立的事实。',
  '严格排除：提问、闲聊、附和、一次性指令、思考过程、临时状态、对某条消息的即时反应、调试输出。',
  'kind：task=目标/决策/进展/约束；people=用户身份/稳定偏好/沟通方式；resource=账号/密钥/路径/服务器等资源；capability=工具或能力缺口。',
  'scope：user=跨项目都成立的用户本人稳定特征；project=只在当前项目成立的具体事；session=只跟当前这次会话相关。',
  '铁律：一句具体的项目内讨论或随口想法绝不能标 user；拿不准或只是碎片就不要提炼。宁可一条都不记，也不要记噪声。',
  '只输出 JSON：{"facts":[{kind,scope,title,body,importance(1-5),confidence(0-1)}]}，没有可记的事实就返回 {"facts":[]}。',
].join('\n');

export const RECONCILE_SYSTEM = [
  '你在维护一个行动记忆库。对每条候选事实，对照它同类同作用域的现有记忆，给出一个操作：',
  'ADD=全新的事实，库里没有；UPDATE=已有同主题记忆但新信息更新/更全(给出合并后的 title/body)；',
  'NOOP=已有记忆已覆盖，无需变动；DELETE=某条现有记忆已被新信息证伪或过时(给 targetId)。',
  'targetId 只能取所给候选现有记忆的 id，不得编造。默认 ADD。',
  '只输出 JSON：{"decisions":[{factIndex,op,targetId?,title?,body?}]}。',
].join('\n');
