import type { CREATOR_CADENCES, KEYWORD_TIME_WINDOWS, JOB_KINDS, JOB_STATUSES } from './constants';

export type CreatorCadence = (typeof CREATOR_CADENCES)[number];
export type KeywordTimeWindow = (typeof KEYWORD_TIME_WINDOWS)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type CreatorCollectMode = 'recent' | 'full';

// Index signatures so these record types satisfy the
// `Record<string, unknown>` constraint of the AppDataStore generics.
export interface CreatorRecord {
  [key: string]: unknown;
  sec_uid?: string | null;
  uid?: string | null;
  nickname: string;
  avatar?: string | null;
  follow_count?: number | null;
  cadence: CreatorCadence;
  last_checked_at?: string | null;
  last_failure_reason?: string | null;
  enabled: boolean;
  updated_at?: string;
}

export interface KeywordRecord {
  [key: string]: unknown;
  query: string;
  time_window: KeywordTimeWindow;
  dedupe_window_days: number;
  cadence: CreatorCadence;
  last_checked_at?: string | null;
  last_failure_reason?: string | null;
  enabled: boolean;
  updated_at?: string;
}

export interface CollectJobRecord {
  [key: string]: unknown;
  kind: JobKind;
  target_ref: string;
  status: JobStatus;
  started_at?: string | null;
  ended_at?: string | null;
  failure_reason?: string | null;
  discovered_count: number;
  transcribed_count: number;
  /**
   * 是否在元数据采集后继续跑「字幕→摘要→入库」完整链路。
   * 缺省视为 true（对齐同步 douyin_search_keyword 的 auto_process 默认）。
   * false 时只采元数据，且任务终态消息如实写明「仅元数据，未处理内容」。
   */
  auto_process?: boolean;
  /**
   * AI / IM 入口是否要求把处理结果发布到默认资料库。
   * undefined 代表沿用全局 autoPublish 设置；true / false 代表本次 job 的
   * 显式语义，避免工具文案承诺“入库”但运行时只抓字幕。
   */
  publish_to_knowledge?: boolean;
  /**
   * 博主采集模式：recent=快速采当前已加载批次；full=长滚动尽量采全。
   */
  creator_collect_mode?: CreatorCollectMode;
  /**
   * 本次博主采集最多发现多少条视频。主要用于 full 模式防止无限滚动失控。
   */
  max_videos?: number;
  updated_at?: string;
}
