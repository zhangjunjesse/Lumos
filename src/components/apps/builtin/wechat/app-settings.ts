/**
 * Persisted app settings for the WeChat assistant.
 *
 * Storage: a single JSON blob in the `settings` table under the key
 * `apps.wechat-assistant.settings.v1`. Server reads/writes go through
 * `lib/wechat-assistant/settings-store.ts` (which deep-merges with
 * DEFAULT_SETTINGS so older blobs missing newer fields stay safe).
 *
 * Provider list comes from Lumos `getAllProviders()` filtered by usable
 * `text-gen` API-key providers, not from this file — there is no mock here.
 */

import { DEFAULT_PROMPTS } from './default-prompts';

export type NotificationChannel = 'desktop' | 'wechat_im' | 'feishu' | 'email';

export const NOTIFICATION_CHANNEL_LABEL: Record<NotificationChannel, string> = {
  desktop: 'Lumos 桌面',
  wechat_im: '微信 IM',
  feishu: '飞书',
  email: '邮箱',
};

export type AnalysisWindow = 1 | 7 | 14 | 30 | 60;
export type AnalysisSchedule = 'manual' | 'daily' | 'every_4h';
export type AISensitivity = 'strict' | 'balanced' | 'loose';

export const ANALYSIS_WINDOW_LABEL: Record<AnalysisWindow, string> = {
  1: '最近 1 天',
  7: '最近 7 天',
  14: '最近 14 天',
  30: '最近 30 天',
  60: '最近 60 天',
};

export const ANALYSIS_SCHEDULE_LABEL: Record<AnalysisSchedule, string> = {
  manual: '手动触发',
  daily: '每天 09:00',
  every_4h: '每 4 小时',
};

export const SENSITIVITY_LABEL: Record<AISensitivity, string> = {
  strict: '严格',
  balanced: '适中',
  loose: '宽松',
};

export const SENSITIVITY_HINT: Record<AISensitivity, string> = {
  strict: '只识别明确的事件和承诺，AI 候选最少',
  balanced: '默认。识别比较有把握的跟进项',
  loose: '识别更多模糊信号，AI 候选更多但杂',
};

export type TopicBatchSize = 200 | 500 | 1000 | 2000;
export type TopicMinChatMessages = 5 | 10 | 20 | 50;

export const TOPIC_BATCH_SIZES: TopicBatchSize[] = [200, 500, 1000, 2000];
export const TOPIC_MIN_CHAT_MESSAGES: TopicMinChatMessages[] = [5, 10, 20, 50];

export interface AppSettings {
  ai: {
    /** null = follow Lumos global default provider. */
    providerId: string | null;
    /** null = follow provider's first available model. */
    model: string | null;
    windowDays: AnalysisWindow;
    schedule: AnalysisSchedule;
    sensitivity: AISensitivity;
    prompts: Record<import('./default-prompts').PromptKey, string>;
  };
  overview: {
    showInteractionRank: boolean;
    showHeatmap: boolean;
    showTopics: boolean;
  };
  notifications: {
    proactiveEnabled: boolean;
    channels: NotificationChannel[];
  };
  /**
   * 白名单。非空时,只分析名单内的会话/人(优先级高于黑名单)。
   * 默认空数组 = 不限,所有可读会话都进分析。
   */
  includedPersonIds: string[];
  /** wxid list whose messages are excluded from analysis(白名单为空时全分析,这一项过滤掉黑名单内的) */
  excludedPersonIds: string[];
  /**
   * Topic analysis is opt-in: only chats explicitly added to one of these
   * whitelists get sent to the LLM. Default = empty = nothing analyzed.
   */
  topicAnalysis: {
    /** wxids of personal (1-on-1) chats opted in */
    whitelistPersonal: string[];
    /** wxids of group chats opted in (e.g. "xxx@chatroom") */
    whitelistGroups: string[];
    /** Max messages per single LLM call. */
    maxMessagesPerCall: TopicBatchSize;
    /** Skip chats with fewer than this many messages in the window. */
    minChatMessages: TopicMinChatMessages;
  };
  followups: {
    /** 0..23 */
    defaultReminderHour: number;
  };
}

/**
 * Sanitised provider option served to the client. The server filters the
 * full ApiProvider list down to text-gen capable ones and strips api_key /
 * base_url before sending.
 */
export interface ProviderOption {
  id: string;
  name: string;
  origin: 'system' | 'preset' | 'custom';
  isDefault: boolean;
  models: { value: string; label: string }[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    providerId: null,
    model: null,
    windowDays: 1,
    schedule: 'manual',
    sensitivity: 'balanced',
    prompts: { ...DEFAULT_PROMPTS },
  },
  overview: {
    showInteractionRank: true,
    showHeatmap: true,
    showTopics: true,
  },
  notifications: {
    proactiveEnabled: false,
    channels: ['desktop'],
  },
  includedPersonIds: [],
  excludedPersonIds: [],
  topicAnalysis: {
    whitelistPersonal: [],
    whitelistGroups: [],
    maxMessagesPerCall: 500,
    minChatMessages: 10,
  },
  followups: {
    defaultReminderHour: 9,
  },
};
