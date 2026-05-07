/**
 * Shared overview-tab types — safe to import from both client and server.
 *
 * Decoupled from `Person` (which is the AI-derived relations domain) so the
 * overview can ship on real chat statistics without depending on group / tone
 * inference that happens later in the pipeline.
 */

export interface OverviewDay {
  /** 0 = today, 13 = 14 days ago */
  daysAgo: number;
  count: number;
}

export interface OverviewRow {
  id: string; // wxid
  name: string;
  isGroup: boolean;
  /** Total message count within the analysis window. */
  messageCount: number;
  /** Share of messages sent by "me", 0..1. NaN-safe → 0 when no messages. */
  yourShare: number;
  /** Unix ms of the most recent message (could be older than the window). */
  lastTs: number;
  /** Always length 14, indexed by daysAgo. */
  interactionDays: OverviewDay[];
}

export interface OverviewTotals {
  /** Distinct chats that had at least one message inside the window. */
  activeChats: number;
  /** Total messages inside the window across all included chats. */
  messagesInWindow: number;
  /** Chats whose last message is older than 14 days (silent ≥ 14d). */
  silentCount: number;
}

export interface OverviewEmojiInsight {
  emoji: string;
  count: number;
}

export interface OverviewLateChatInsight {
  id: string;
  name: string;
  messages: number;
  share: number;
}

export interface OverviewCommitmentInsight {
  id: string;
  text: string;
  who: string;
  promisedAt: number;
}

export interface OverviewMentionInsight {
  id: string;
  name: string;
  mentions: number;
}

export interface OverviewReportInsights {
  emoji: OverviewEmojiInsight[];
  lateChat: {
    totalLateMessages: number;
    share: number;
    rows: OverviewLateChatInsight[];
  };
  commitments: OverviewCommitmentInsight[];
  mentionWeek: OverviewMentionInsight[];
}

export interface OverviewData {
  /** Unix ms when the snapshot was computed. */
  generatedAt: number;
  windowDays: number;
  totals: OverviewTotals;
  /** All chats (personal + group), unfiltered, for downstream filtering. */
  rows: OverviewRow[];
  /** Lightweight real-data aggregates used by custom report cards. */
  reportInsights: OverviewReportInsights;
}

export type OverviewReason =
  | 'unsupported_platform'
  | 'consent_required'
  | 'no_key'
  | 'no_sync_yet'
  | 'snapshot_failed';

export type OverviewResponse =
  | { ready: true; data: OverviewData }
  | { ready: false; reason: OverviewReason; message?: string };
