import type { PortraitData } from './portrait-types';

export type AppTab = 'overview' | 'portrait' | 'content' | 'automation';

export interface WeChatAssistantStatus {
  app: { id: string; name: string; version: string; source: string; status: string };
  export: {
    supported: boolean;
    ready: boolean;
    phase: string;
    message?: string;
    keyCount?: number;
    lastExtractedAt?: number | null;
    mcp?: { enabled: boolean };
  };
  im: {
    configured: boolean;
    enabled: boolean;
    isDefault: boolean;
    routedSessionId: string | null;
    routedSessionTitle: string | null;
  };
}

export interface AnalysisHighlight {
  title: string;
  description: string;
  tone: 'default' | 'warning' | 'danger' | 'success';
  ts?: number;
}

export interface AnalysisTodo {
  text: string;
  display: string;
  ts: number;
  confidence: 'high' | 'medium';
}

export interface AnalysisTopConversation {
  wxid: string;
  display: string;
  count: number;
  unread: number;
  lastAt: number;
  isGroup: boolean;
}

export interface AnalysisContentTopic {
  id: string;
  title: string;
  theme: string;
  angle: string;
  format: string;
  score: number;
  reason: string;
  interestLabel: string;
  interestReason: string;
  spreadLabel: string;
  spreadNarrative: string;
  messageCount: number;
  conversationCount: number;
  groupCount: number;
  contactCount: number;
  tags: string[];
  examples: Array<{ display: string; ts: number; text: string }>;
  sources: Array<{
    wxid: string;
    display: string;
    count: number;
    isGroup: boolean;
    firstAt: number;
    lastAt: number;
  }>;
}

export interface AnalysisContentInsights {
  summary: string;
  topics: AnalysisContentTopic[];
  relationshipSignals: Array<{
    label: string;
    description: string;
    value: string;
    contacts: Array<{
      wxid: string;
      display: string;
      count: number;
      isGroup: boolean;
      firstAt: number;
      lastAt: number;
    }>;
  }>;
  channelSuggestions: Array<{
    channel: '朋友圈' | '公众号' | '短视频' | '选题库';
    title: string;
    fit: string;
    nextAction: string;
    sourceTopic: string;
  }>;
  drafts: Array<{
    title: string;
    hook: string;
    format: string;
    outline: string[];
    sourceTopic: string;
    privacyNote: string;
  }>;
}

export interface Analysis {
  generatedAt: number;
  summary: string;
  source: {
    scope: string;
    sessionsScanned: number;
    messagesScanned: number;
    totalReadableMessages: number;
    selectedReadableMessages: number;
    messagesTruncated: boolean;
    scanScope: string;
    safetyLimit: number;
    todayMessages: number;
    unreadSessions: number;
  };
  metrics: Array<{ label: string; value: string; detail: string }>;
  highlights: AnalysisHighlight[];
  todos: AnalysisTodo[];
  topConversations: AnalysisTopConversation[];
  keywordTrends: Array<{ keyword: string; count: number }>;
  contentInsights: AnalysisContentInsights;
  portrait: PortraitData;
}

export interface BuiltinTask {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  schedule: string;
  lastRunAt: number | null;
  lastResult: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-consent':
      return '需要授权';
    case 'needs-env':
      return '需要环境准备';
    case 'needs-resign':
      return '需要放开微信读取';
    case 'needs-extract':
      return '需要恢复密钥';
    case 'needs-restore':
      return '建议恢复微信';
    case 'unsupported':
      return '暂不支持';
    default:
      return '加载中';
  }
}

export function readableAnalysisError(error?: string, message?: string): string {
  if (error === 'consent_required') return '需要先完成微信消息读取授权。';
  if (error === 'no_key') return '还没有恢复微信数据库密钥，请先完成数据授权。';
  if (error === 'unsupported_platform') return '当前 Demo 先支持 macOS 本机微信。';
  return message ?? error ?? '分析失败';
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatSeconds(seconds: number): string {
  if (!seconds) return '';
  return formatDateTime(seconds * 1000);
}

export function greetingFor(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  if (hour < 22) return '晚上好';
  return '夜深了';
}
