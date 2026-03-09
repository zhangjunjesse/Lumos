import { getSetting } from '@/lib/db';
import { buildMemoryContextForPrompt } from '@/lib/memory/runtime';
import { getMindPersonaProfile } from '@/lib/mind/profile';
import { getMindRulesProfile } from '@/lib/mind/rules-profile';
import { getMindUserProfile } from '@/lib/mind/user-profile';

export interface MindRuntimePackSection {
  key: 'user' | 'persona' | 'rules' | 'memory';
  title: string;
  enabled: boolean;
  lineCount: number;
  preview: string;
}

export interface MindRuntimePackResult {
  additionalContext: string;
  sourceOrder: string[];
  sections: MindRuntimePackSection[];
  memoryItems: number;
}

function cleanLine(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function lineCount(value: string): number {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
}

function countMemoryItems(value: string): number {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s/.test(line))
    .length;
}

function mapDecisionDomain(value: string): string {
  const map: Record<string, string> = {
    engineering: '工程开发',
    product: '产品策略',
    analysis: '数据分析',
    operations: '运营增长',
    manufacturing: '制造与交付',
    family: '家庭与生活',
    education: '学习与教育',
    other: '其他',
  };
  return map[value] || value;
}

function mapQualityCriterion(value: string): string {
  const map: Record<string, string> = {
    accuracy: '准确性',
    actionability: '可执行性',
    speed: '响应速度',
    risk_control: '风险可控',
    experience: '体验质量',
    cost: '成本效率',
    innovation: '创新性',
  };
  return map[value] || value;
}

function mapResponseStructure(value: string): string {
  const map: Record<string, string> = {
    conclusion_steps: '先结论后步骤',
    option_compare: '方案对比后决策',
    teaching_explain: '讲解式推导',
    checklist_execute: '清单式执行',
  };
  return map[value] || value;
}

function mapUncertaintyMode(value: string): string {
  const map: Record<string, string> = {
    slow_precise: '慢一点但更严谨',
    estimate_then_verify: '先估计再校验',
    advance_then_calibrate: '先推进后校准',
  };
  return map[value] || value;
}

function mapCadence(value: string): string {
  const map: Record<string, string> = {
    confirm_each_step: '每步确认',
    milestone_sync: '里程碑同步',
    final_summary: '最后汇总',
  };
  return map[value] || value;
}

function mapUserCustomCategory(value: string): string {
  const map: Record<string, string> = {
    communication: '沟通表达',
    decision: '决策偏好',
    boundary: '边界限制',
    trigger: '触发场景',
    aesthetic: '审美偏好',
    industry: '行业上下文',
    family: '家庭场景',
    other: '其他',
  };
  return map[value] || value;
}

function mapRoleMode(value: string): string {
  const map: Record<string, string> = {
    assistant: '执行助手',
    advisor: '判断顾问',
    coach: '成长教练',
  };
  return map[value] || value;
}

function mapProactivity(value: string): string {
  const map: Record<string, string> = {
    passive: '按需响应',
    balanced: '平衡主动',
    proactive: '主动推进',
  };
  return map[value] || value;
}

function mapChallengeLevel(value: string): string {
  const map: Record<string, string> = {
    compliant: '尽量顺从',
    gentle: '温和提醒',
    strong: '强提醒与挑战',
  };
  return map[value] || value;
}

function mapRiskStyle(value: string): string {
  const map: Record<string, string> = {
    conservative: '稳健保守',
    balanced: '平衡推进',
    aggressive: '激进试探',
  };
  return map[value] || value;
}

function mapMemoryStyle(value: string): string {
  const map: Record<string, string> = {
    strict: '严格相关才引用',
    balanced: '适度引用',
    active: '主动联想引用',
  };
  return map[value] || value;
}

function mapPersonaPolicyCategory(value: string): string {
  const map: Record<string, string> = {
    workflow: '流程',
    risk: '风险',
    communication: '沟通',
    memory: '记忆',
    safety: '安全',
    other: '其他',
  };
  return map[value] || value;
}

function splitKeywords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s,，;；。!！?？/\\|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);
}

function scoreByPrompt(promptKeywords: string[], trigger: string): number {
  if (promptKeywords.length === 0) return 0;
  const triggerKeywords = splitKeywords(trigger);
  if (triggerKeywords.length === 0) return 0;
  let score = 0;
  for (const token of promptKeywords) {
    if (triggerKeywords.some((triggerToken) => triggerToken.includes(token) || token.includes(triggerToken))) {
      score += 1;
    }
  }
  return score;
}

function selectRelevantCustomRules<T extends { trigger: string; priority: number }>(
  prompt: string,
  items: T[],
  maxItems = 4,
): T[] {
  const promptKeywords = splitKeywords(prompt);
  return items
    .map((item) => ({
      item,
      score: scoreByPrompt(promptKeywords, item.trigger) + item.priority * 0.25,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems)
    .map((entry) => entry.item);
}

function buildUserSection(prompt: string): string {
  const user = getMindUserProfile();
  const customRules = selectRelevantCustomRules(
    prompt,
    user.customPreferences.filter((item) => item.enabled),
    5,
  );
  const lines = [
    '<lumos_user>',
    '以下为用户长期画像与偏好，请只在相关时启用，并始终服从当前轮明确指令。',
    `称呼偏好：${cleanLine(user.preferredName, 64)}`,
    `长期身份：${cleanLine(user.longTermIdentity, 240)}`,
    `核心决策域：${user.primaryDecisionDomains.map(mapDecisionDomain).join('、')}`,
    `质量优先级：${user.qualityCriteriaOrder.map(mapQualityCriterion).join(' > ')}`,
    `输出结构偏好：${mapResponseStructure(user.responseStructure)}`,
    `不确定性处理偏好：${mapUncertaintyMode(user.uncertaintyMode)}`,
    `协作节奏偏好：${mapCadence(user.collaborationCadence)}`,
    `明确红线：${cleanLine(user.hardBoundaries.join('；'), 280)}`,
    `高压信号：${cleanLine(user.pressureSignals.join('、'), 220)}`,
    `审美标准：${cleanLine(user.aestheticStandards.join('、'), 220)}`,
  ];

  if (customRules.length > 0) {
    lines.push('用户扩展偏好：');
    for (const rule of customRules) {
      lines.push(
        `- [${mapUserCustomCategory(rule.category)}] 当“${cleanLine(rule.trigger, 120)}”时，优先“${cleanLine(rule.expectedAction, 150)}”${rule.antiPattern ? `；避免“${cleanLine(rule.antiPattern, 120)}”` : ''}${rule.force ? '；强约束=是' : ''}`,
      );
    }
  }

  lines.push('</lumos_user>');
  return lines.join('\n');
}

function buildPersonaSection(prompt: string): string {
  const persona = getMindPersonaProfile();
  const customPolicies = selectRelevantCustomRules(
    prompt,
    persona.customPolicies.filter((item) => item.enabled),
    4,
  );
  const lines = [
    '<lumos_persona>',
    `身份定义：${cleanLine(persona.identity, 160)}`,
    `关系定义：${cleanLine(persona.relationship, 220)}`,
    `表达语气：${cleanLine(persona.tone, 160)}`,
    `长期使命：${cleanLine(persona.mission, 220)}`,
    `角色模式：${mapRoleMode(persona.roleMode)}`,
    `主动性：${mapProactivity(persona.proactivity)}`,
    `挑战强度：${mapChallengeLevel(persona.challengeLevel)}`,
    `风险风格：${mapRiskStyle(persona.riskStyle)}`,
    `记忆风格：${mapMemoryStyle(persona.memoryStyle)}`,
  ];
  if (customPolicies.length > 0) {
    lines.push('Lumos 扩展策略：');
    for (const policy of customPolicies) {
      lines.push(
        `- [${mapPersonaPolicyCategory(policy.category)}] 当“${cleanLine(policy.trigger, 120)}”时，执行“${cleanLine(policy.expectedAction, 150)}”${policy.antiPattern ? `；避免“${cleanLine(policy.antiPattern, 120)}”` : ''}${policy.force ? '；强约束=是' : ''}`,
      );
    }
  }
  lines.push('</lumos_persona>');
  return lines.join('\n');
}

function buildRulesSection(): string {
  const rules = getMindRulesProfile();
  return [
    '<lumos_rules>',
    '优先级顺序：',
    '1. 平台与安全规则最高优先。',
    '2. 当前轮用户明确指令优先于历史偏好。',
    '3. 遵循 Lumos 角色与协作约定。',
    '4. 仅在相关时使用持久记忆。',
    `协作风格：${cleanLine(rules.collaborationStyle, 260)}`,
    `回复规则：${cleanLine(rules.responseRules, 260)}`,
    `安全边界：${cleanLine(rules.safetyBoundaries, 260)}`,
    `记忆策略：${cleanLine(rules.memoryPolicy, 260)}`,
    '</lumos_rules>',
  ].join('\n');
}

export function buildMindRuntimePack(params: {
  sessionId: string;
  projectPath?: string;
  prompt: string;
  maxMemoryItems?: number;
  trackMemoryUsage?: boolean;
}): MindRuntimePackResult {
  const sourceOrder = [
    'platform_safety',
    'user_current_turn',
    'lumos_user',
    'lumos_persona',
    'lumos_rules',
    'persisted_memory',
  ];

  const userSection = buildUserSection(params.prompt);
  const personaSection = buildPersonaSection(params.prompt);
  const rulesSection = buildRulesSection();
  const memorySection = buildMemoryContextForPrompt({
    sessionId: params.sessionId,
    projectPath: params.projectPath,
    prompt: params.prompt,
    maxItems: params.maxMemoryItems,
    trackUsage: params.trackMemoryUsage !== false,
  });

  const additionalContext = [userSection, personaSection, rulesSection, memorySection]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const memoryEnabled = getSetting('memory_system_enabled') !== 'false';

  const sections: MindRuntimePackSection[] = [
    {
      key: 'user',
      title: 'User',
      enabled: true,
      lineCount: lineCount(userSection),
      preview: cleanLine(userSection.replace(/<\/?lumos_user>/g, ''), 240),
    },
    {
      key: 'persona',
      title: 'Persona',
      enabled: true,
      lineCount: lineCount(personaSection),
      preview: cleanLine(personaSection.replace(/<\/?lumos_persona>/g, ''), 220),
    },
    {
      key: 'rules',
      title: 'Rules',
      enabled: true,
      lineCount: lineCount(rulesSection),
      preview: cleanLine(rulesSection.replace(/<\/?lumos_rules>/g, ''), 240),
    },
    {
      key: 'memory',
      title: 'Memory',
      enabled: memoryEnabled,
      lineCount: lineCount(memorySection),
      preview: memorySection
        ? cleanLine(memorySection.replace(/<\/?lumos_memory>/g, ''), 240)
        : '当前没有命中的相关记忆。',
    },
  ];

  return {
    additionalContext,
    sourceOrder,
    sections,
    memoryItems: countMemoryItems(memorySection),
  };
}
