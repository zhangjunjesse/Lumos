// 平台团队的「能力广告」:把团队名单渲染成 LLM 可读清单。
//
// 单一真源 —— 所有会生成/修改工作流 DSL 的 LLM 入口(一句话生成 builder、AI 改工作流
// refine、工作流 AI 助手)都必须拼这个块。历史教训:builder 曾自己手搓一份,refine 和
// 工作流助手漏拼;而提示词里有条硬规则「AVAILABLE TEAMS 为空时不要使用 team 节点」——
// 名单没拼等于把 team 节点在那两个入口整个关掉,用户看到的症状是「AI 说不能用团队」。
// 新增入口一律复用本函数,不要再抄一份。

import { quotePromptField } from '@/lib/llm/prompt-field';
import { resolveReadyMembers } from './resolve-members';
import { listTeams } from './store';

/** 清单块标题;提示词正文的规则按这个名字引用(见 default-prompts 的 team 节点段)。 */
export const AVAILABLE_TEAMS_HEADING = '## AVAILABLE TEAMS';

/** 空名单占位:与提示词里「为空时不要使用 team 节点」的规则对齐。 */
export const EMPTY_TEAMS_BLOCK = `\n${AVAILABLE_TEAMS_HEADING}\n(none — do not use team nodes)`;

export function buildTeamListBlock(): string {
  const teams = listTeams();
  if (teams.length === 0) return EMPTY_TEAMS_BLOCK;

  const lines = teams.map((team) => {
    // 就绪成员 = 启用且人设完整,与运行时派单口径一致(resolveReadyMembers)。
    // 用声明成员数会谎报:人设被删的引用还在 memberRefs 里,但队长派不出单。
    const ready = resolveReadyMembers(team);
    const parts = [
      `- id: ${quotePromptField(team.id)}`,
      `name: ${quotePromptField(team.name)}`,
    ];
    if (team.description) parts.push(`description: ${quotePromptField(team.description)}`);
    if (team.sop) parts.push(`sop: ${quotePromptField(team.sop)}`);
    parts.push(`members: ${ready.length}`);
    parts.push(
      ready.length > 0
        ? `roster: ${quotePromptField(ready.map((m) => `${m.name}(${m.duty})`).join('、'))}`
        : 'unusable: 无可用成员(人设缺失或全部停用),不要选这个团队',
    );
    return parts.join('  ');
  });

  return `\n${AVAILABLE_TEAMS_HEADING}\n${lines.join('\n')}`;
}
