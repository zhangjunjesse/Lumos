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
  /** 允许清单(仅这些工具)。etsy 出图团队用——把成员限死在出图/读。 */
  tools?: string[];
  /** 禁用清单(继承会话全部工具之上做减法)。聊天团队用——成员默认能用全部 MCP/skill,只挡危险项。 */
  disallowedTools?: string[];
  /**
   * 成员绑定的图片服务商显示名。团队出图走 stdio HTTP 回调、拿不到"当前成员",
   * 唯一能让成员身份影响出图的注入点就是成员自己的提示词:让成员出图时在
   * generate_image 的 image_provider 参数填这个名字,由 T5.1 逃生舱解析成 id。
   * 成员没绑则不注入,自然降级到团队默认(runToken)→ 全局默认。
   */
  imageProviderName?: string;
}

export function toAgentDefinitions(specs: TeamAgentSpec[]): NonNullable<Options['agents']> {
  const agents: NonNullable<Options['agents']> = {};
  for (const s of specs) {
    if (!s.prompt.trim()) continue;
    // 成员绑了图片服务商:在提示词里让它出图时自报服务商(逃生舱接住)。
    // 这是当前架构下成员级分流的唯一注入点——团队出图 HTTP 回调拿不到成员身份。
    const imagePrefixNotice = s.imageProviderName
      ? `\n\n【出图服务商】你出图时,generate_image 工具的 image_provider 参数必须填 "${s.imageProviderName}"——这是你被指定的图片服务商,不要改用别的、也不要留空。`
      : '';
    // tools 省略 = 继承父级全部工具(SDK 语义);给 tools 则限死为允许清单。
    agents[s.key] = {
      description: s.description,
      prompt: s.prompt + imagePrefixNotice,
      model: 'inherit',
      ...(s.tools ? { tools: s.tools } : {}),
      ...(s.disallowedTools && s.disallowedTools.length > 0 ? { disallowedTools: s.disallowedTools } : {}),
    };
  }
  return agents;
}

export function agentKeyOf(name: string): string {
  return name.replace(/\s+/g, '-');
}
