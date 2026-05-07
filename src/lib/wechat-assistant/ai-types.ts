/**
 * Shared types between AI extraction layer, DB layer, API routes and UI.
 *
 * The AI agent emits these as JSON. The DB stores them after light shaping
 * (id minted, timestamps added). The API mirrors the DB rows back out.
 */

export type EventUrgency = 'urgent' | 'important' | 'attention';

export interface WeChatEventInput {
  title: string;
  urgency: EventUrgency;
  contactWxid: string;
  contactDisplay: string;
  isGroup: boolean;
  evidenceMsgIds: number[];
  evidenceTexts: string[];
  suggestedAction: string;
  lastAt: number;
}

export interface WeChatEvent extends WeChatEventInput {
  id: string;
  runId: string;
  createdAt: number;
}

export type TodoSource = 'self' | 'other' | 'manual';
export type TodoStatus = 'suggested' | 'open' | 'in_progress' | 'done' | 'dismissed';
export type TodoConfidence = 'high' | 'medium';
export type TodoFollowupType = 'reply' | 'commitment' | 'event' | 'health' | 'other';

export interface WeChatTodoSuggestionInput {
  text: string;
  source: 'self' | 'other';
  sourceMsgId: number | null;
  sourceText: string | null;
  sourceDisplay: string | null;
  sourceSenderDisplay?: string | null;
  sourceWxid: string | null;
  byWhenText: string | null;
  dueAt: number | null;
  confidence: TodoConfidence;
}

export interface ManualTodoInput {
  text: string;
  sourceWxid?: string | null;
  sourceDisplay?: string | null;
  involvedWxids?: string[];
  summary?: string | null;
  nextStep?: string | null;
  followupType?: TodoFollowupType | null;
  byWhenText?: string | null;
  dueAt?: number | null;
  remindAt?: number | null;
}

export interface WeChatTodo {
  id: string;
  runId: string | null;
  text: string;
  source: TodoSource;
  sourceMsgId: number | null;
  sourceText: string | null;
  sourceDisplay: string | null;
  sourceSenderDisplay: string | null;
  sourceWxid: string | null;
  involvedWxids: string[];
  byWhenText: string | null;
  summary: string | null;
  nextStep: string | null;
  followupType: TodoFollowupType | null;
  dueAt: number | null;
  remindAt: number | null;
  confidence: TodoConfidence | null;
  status: TodoStatus;
  createdAt: number;
  confirmedAt: number | null;
  doneAt: number | null;
}

export interface WeChatAssistantRun {
  id: string;
  snapshotHash: string;
  providerId: string | null;
  model: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'done' | 'failed';
  message: string | null;
  eventsCount: number;
  todosCount: number;
  tokensIn: number | null;
  tokensOut: number | null;
  messagesScanned: number;
}

export interface WeChatAssistantAIPayload {
  events: WeChatEventInput[];
  todos: WeChatTodoSuggestionInput[];
}
