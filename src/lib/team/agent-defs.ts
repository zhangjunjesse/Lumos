// 团队成员 → SDK AgentDefinition(平台通用)。
// 工具面由声明式清单决定(唯一可靠的权限控制——canUseTool 等控制协议回调在
// 复杂多子代理会话里必断,见 docs/chat-team-design.md §5.2)。

import type { Options } from '@anthropic-ai/claude-agent-sdk';

export interface TeamAgentSpec {
  /** 派单用的 subagent_type(成员名去空格) */
  key: string;
  /** 职能描述——队长决定派单对象的依据 */
  description: string;
  /** 成员人设提示词 */
  prompt: string;
  /** 声明式工具清单 */
  tools: string[];
}

export function toAgentDefinitions(specs: TeamAgentSpec[]): NonNullable<Options['agents']> {
  const agents: NonNullable<Options['agents']> = {};
  for (const s of specs) {
    if (!s.prompt.trim()) continue;
    agents[s.key] = {
      description: s.description,
      prompt: s.prompt,
      tools: s.tools,
      model: 'inherit',
    };
  }
  return agents;
}

export function agentKeyOf(name: string): string {
  return name.replace(/\s+/g, '-');
}
