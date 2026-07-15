// 团队会话 SDK 流的解析原语:事件类型 + 防御式消息/工具结果解析。
// 与 team-session 分家,让后者专注编排、这里专注「从 SDK 流里读出发生了什么」。

// 团队执行过程事件——喂给上层记进应用日志,让用户看得见队长在干嘛、卡在哪。
// team-session 只负责产出事件,不认识 etsy 日志系统(解耦);映射见 run-team。
export type TeamEvent =
  | { kind: 'dispatch'; to: string; task: string } // 队长派单给某成员
  | { kind: 'speak'; member: string; text: string } // 队长/成员的一段思考或交付文本
  | { kind: 'image_call'; member: string; seq: number; prompt: string } // 某成员发起一次出图
  | { kind: 'image_ok'; seq: number; path: string } // 出图成功
  | { kind: 'image_fail'; seq: number; error: string } // 出图失败(真实错误,如 Stream closed/计费拒绝)
  | { kind: 'quota_denied'; used: number; cap: number } // 出图配额被拒
  | { kind: 'done'; subtype: string; turns: number; errors: string[] }; // 会话终态

export const LEADER = '队长';
export const clip = (s: string, n = 220): string => (s.length > n ? `${s.slice(0, n)}…` : s);

// SDK 流消息的鸭子类型(只取我们关心的字段,防御式解析)。
export interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}
export interface StreamMessage {
  type?: string;
  subtype?: string;
  subagent_type?: string;
  structured_output?: unknown;
  num_turns?: number;
  errors?: unknown[];
  message?: { content?: unknown };
}

export function asArray(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}
export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// tool_result 的 content 可能是字符串或 MCP content 块数组;取里面第一段文本。
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  for (const b of asArray(content)) {
    if (b.type === 'text' && typeof b.text === 'string') return b.text;
  }
  return '(无内容)';
}

// 从 generate_image 的 tool_result 里抠出第一张图路径;不是成功结构则返回空(交给失败分支)。
export function firstImagePath(content: unknown): string {
  try {
    const payload = JSON.parse(toolResultText(content)) as { images?: Array<{ path?: string }> };
    const p = payload.images?.[0]?.path;
    return typeof p === 'string' ? p : '';
  } catch {
    return '';
  }
}

// 流解析器:逐条消化 SDK 流消息,产出团队事件。有状态(出图序号 + tool_use_id→序号映射),
// 抽成独立类是为了能脱离真实 SDK 会话做单测(锁住消息形状假设)。
export class TeamStreamParser {
  private seq = 0;
  private seqById = new Map<string, number>();
  structured: unknown;

  constructor(private readonly imageToolName: string, private readonly emit: (ev: TeamEvent) => void) {}

  consume(message: unknown): void {
    const msg = message as StreamMessage;
    if (msg.type === 'assistant' && msg.message?.content) {
      this.consumeAssistant(msg.subagent_type || LEADER, msg.message.content);
    } else if (msg.type === 'user' && msg.message?.content) {
      this.consumeToolResults(msg.message.content);
    } else if (msg.type === 'result') {
      if (msg.structured_output) this.structured = msg.structured_output;
      this.emit({
        kind: 'done',
        subtype: str(msg.subtype) || 'unknown',
        turns: Number(msg.num_turns) || 0,
        errors: Array.isArray(msg.errors) ? msg.errors.map((e) => String(e)) : [],
      });
    }
  }

  private consumeAssistant(who: string, content: unknown): void {
    for (const block of asArray(content)) {
      if (block.type === 'text' && block.text?.trim()) {
        this.emit({ kind: 'speak', member: who, text: clip(block.text.trim()) });
      } else if (block.type === 'tool_use' && block.name === 'Task') {
        const to = str(block.input?.subagent_type) || '成员';
        const task = str(block.input?.description) || str(block.input?.prompt);
        this.emit({ kind: 'dispatch', to, task: clip(task, 160) });
      } else if (block.type === 'tool_use' && block.name === this.imageToolName && block.id) {
        this.seq += 1;
        this.seqById.set(block.id, this.seq);
        this.emit({ kind: 'image_call', member: who, seq: this.seq, prompt: clip(str(block.input?.prompt), 180) });
      }
    }
  }

  private consumeToolResults(content: unknown): void {
    for (const block of asArray(content)) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      const seq = this.seqById.get(block.tool_use_id);
      if (seq === undefined) continue; // 不是出图的结果
      const path = firstImagePath(block.content);
      if (path) this.emit({ kind: 'image_ok', seq, path });
      else this.emit({ kind: 'image_fail', seq, error: clip(toolResultText(block.content), 200) });
    }
  }
}

