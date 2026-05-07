import type { LlmMessage } from './ai-snapshot-crop';
import { displayWechatName } from './wechat-text';

export const AI_SYSTEM_PROMPT = `你是用户的私人微信秘书。用户给你过去两周的微信消息（已去除图片/语音/系统消息），你只做两件事：

(A) 找出"事件"——把多条相关消息归并成一句话事件，告诉用户"什么人在等你做什么"。
(B) 抽取"待办"——区分两类：
    - source='self'：用户**自己说出口的承诺**（"明天给你方案"、"周五前搞定"）
    - source='other'：别人明确请用户做的事（"麻烦把合同发我"、"帮看下方案"）

## 事件 (events) 规则

每个事件包含：
- title：一句话事件描述（不超过 30 字），用"谁在等你做什么 / 谁在催什么"的格式
  ✅ "客户张总反复追合同付款" "项目群在等你给方案最终意见"
  ❌ "今日聊天活跃" "高频消息" "上午冲锋"
- urgency：'urgent'（今天必须处理） / 'important'（今明两天） / 'attention'（值得知道但不急）
- contactWxid + contactDisplay + isGroup：消息源。contactWxid 必须填写每个会话标题里的 source 值，例如 "chat_1"，不要填写 wxid/openim/chatroom 等内部 ID
- evidenceMsgIds：引用的消息 idx 数组（必须从输入消息里选，2-5 个，按时间序）
- suggestedAction：建议下一步动作，一句话（"今天 17:00 前回复"、"先回个 emoji 表态再细谈"）

事件输出 ≤ 5 个。按 urgency 排序（urgent > important > attention）。

## 待办 (todos) 规则

每条待办包含：
- text：去掉口语化的核心动作（"周三前给王总方案"、"明早给客户对账单"）
- source：'self' 或 'other'
- sourceMsgId：来自哪条消息的 idx（必填）
- byWhenText：原话里说的截止时间（"周三前"、"明天"、"下周"），没有就 null
- confidence：'high'（明确具体的承诺/请求） / 'medium'（可能是客套）

待办输出 ≤ 8 个。客套话（"改天吃饭"、"有空聊"）confidence='medium' 或干脆不要。

## 严禁
- 不要返回原消息当事件 title
- 不要在 title / text / suggestedAction / byWhenText 里输出 wxid、openim、chatroom、长数字内部 ID
- 不要总结统计（"今天 50 条消息"）
- 不要给"上午冲锋"这种节奏标签
- 群广播 / 通知不算事件
- 同一件事不要在 events 和 todos 里都出现，选最合适的那个放
- 输出必须是合法 JSON，不要 markdown，不要解释

## 输出 schema
{
  "events": [
    {
      "title": string,
      "urgency": "urgent" | "important" | "attention",
      "contactWxid": string,
      "contactDisplay": string,
      "isGroup": boolean,
      "evidenceMsgIds": number[],
      "suggestedAction": string
    }
  ],
  "todos": [
    {
      "text": string,
      "source": "self" | "other",
      "sourceMsgId": number,
      "byWhenText": string | null,
      "confidence": "high" | "medium"
    }
  ]
}
`;

export function buildAiUserPrompt(messages: LlmMessage[]): string {
  return buildAiPromptContext(messages).prompt;
}

export interface AiPromptSourceRef {
  sourceKey: string;
  wxid: string;
  display: string;
  isGroup: boolean;
}

export interface AiPromptContext {
  prompt: string;
  sourcesByKey: Map<string, AiPromptSourceRef>;
}

export function buildAiPromptContext(messages: LlmMessage[]): AiPromptContext {
  if (messages.length === 0) {
    return {
      prompt: '没有可分析的消息。返回 events: [] 和 todos: []。',
      sourcesByKey: new Map(),
    };
  }

  const grouped = new Map<string, {
    sourceKey: string;
    display: string;
    isGroup: boolean;
    items: LlmMessage[];
  }>();
  const sourcesByKey = new Map<string, AiPromptSourceRef>();
  for (const msg of messages) {
    const key = msg.wxid;
    const display = displayWechatName(msg.display, msg.wxid, {
      groupFallback: '微信群聊',
      contactFallback: '微信联系人',
    });
    const bucket = grouped.get(key) ?? {
      sourceKey: `chat_${grouped.size + 1}`,
      display,
      isGroup: msg.isGroup,
      items: [],
    };
    bucket.items.push(msg);
    grouped.set(key, bucket);
    sourcesByKey.set(bucket.sourceKey, {
      sourceKey: bucket.sourceKey,
      wxid: msg.wxid,
      display: bucket.display,
      isGroup: bucket.isGroup,
    });
  }

  const blocks: string[] = [];
  for (const bucket of grouped.values()) {
    const heading = `=== ${bucket.isGroup ? '【群】' : ''}${bucket.display} (source=${bucket.sourceKey}) ===`;
    const lines = bucket.items
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .map(formatMessage);
    blocks.push([heading, ...lines].join('\n'));
  }

  return {
    prompt: `下面是按会话分组的过去两周微信消息。每个会话标题里的 source 是临时编号，仅供 contactWxid 字段引用；不要把 source 或任何内部 ID 写进用户可见文本。请按 system 规则输出 JSON。

${blocks.join('\n\n')}`,
    sourcesByKey,
  };
}

function formatMessage(msg: LlmMessage): string {
  const date = new Date(msg.ts * 1000);
  const stamp = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const who = msg.sender === 'me' ? '我' : msg.isGroup ? msg.senderDisplay || '群成员' : '对方';
  return `[#${msg.idx}] ${stamp} ${who}: ${msg.text}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
