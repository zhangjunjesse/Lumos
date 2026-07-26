// 团队任务执行痕迹收集:把 SDK 消息流分成「队长层」和「按派单分组的成员层」。
//
// 只收集、不渲染 —— 渲染在 workflow 层(team-step-output.ts),那边才有 markdown 格式化器。
// 这样 team 不反向依赖 workflow。
//
// 为什么需要它:team 步骤过去只留下队长最后那段交付文本,详情页里中间几道工序是黑箱
// (成员接了什么活、调了什么工具、交了什么全丢)。丢的地方是消息流里那个
// `!msg.parent_tool_use_id` 判断——带 parent_tool_use_id 的正是成员发的消息。

/** 与 workflow 侧 RawTraceEvent 结构兼容,可直接喂给 formatExecutionTrace。 */
export interface TeamTraceEvent {
  type: 'assistant' | 'user';
  raw: unknown;
}

/** 一次派单及其成员执行明细。 */
export interface TeamMemberSection {
  /** 队长那次 Task 调用的 tool_use id,成员消息靠它归属。 */
  toolUseId: string;
  /** 成员名(取自 Task 调用的 subagent_type)。 */
  member: string;
  events: TeamTraceEvent[];
}

export interface TeamTaskTrace {
  /** 队长层:派单的 Task 调用 + 成员交回的结果。 */
  leader: TeamTraceEvent[];
  /** 成员层:按派单顺序分组。 */
  members: TeamMemberSection[];
}

interface SdkMessageShape {
  type?: string;
  parent_tool_use_id?: string | null;
  message?: {
    content?: Array<{ type?: string; name?: string; id?: string; input?: { subagent_type?: string } }>;
  };
}

const DISPATCH_TOOL_NAMES = new Set(['Task', 'Agent']);

/**
 * 增量收集器:每来一条 SDK 消息喂一次,结束时 build()。
 * 派单工具在 SDK 0.3.207 的消息流里名为 Agent(配置名 Task 仍有效),两个名都认。
 */
export function createTeamTraceCollector() {
  const leader: TeamTraceEvent[] = [];
  /** tool_use id → 成员名,用于把成员消息归到正确的派单下。 */
  const memberOfToolUse = new Map<string, string>();
  /** 保持派单顺序。 */
  const sections = new Map<string, TeamMemberSection>();

  function ensureSection(toolUseId: string): TeamMemberSection {
    const existing = sections.get(toolUseId);
    if (existing) return existing;
    const created: TeamMemberSection = {
      toolUseId,
      member: memberOfToolUse.get(toolUseId) || '成员',
      events: [],
    };
    sections.set(toolUseId, created);
    return created;
  }

  return {
    onMessage(message: unknown): void {
      const msg = message as SdkMessageShape;
      if (msg.type !== 'assistant' && msg.type !== 'user') return;
      const event: TeamTraceEvent = { type: msg.type, raw: message };

      const parentId = msg.parent_tool_use_id;
      if (parentId) {
        // 成员发的消息(或成员的工具结果)
        ensureSection(parentId).events.push(event);
        return;
      }

      // 队长层:先登记派单目标,让后续成员消息能对上名字
      if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use' && block.name && DISPATCH_TOOL_NAMES.has(block.name) && block.id) {
            const member = block.input?.subagent_type || '成员';
            memberOfToolUse.set(block.id, member);
            const section = sections.get(block.id);
            if (section) section.member = member; // 消息乱序时补名
          }
        }
      }
      leader.push(event);
    },

    build(): TeamTaskTrace {
      // 补齐先建 section 后见 Task 调用的情况
      for (const [toolUseId, section] of sections) {
        const known = memberOfToolUse.get(toolUseId);
        if (known) section.member = known;
      }
      return { leader, members: [...sections.values()] };
    },
  };
}
