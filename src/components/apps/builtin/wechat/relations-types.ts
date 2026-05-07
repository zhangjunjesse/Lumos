/**
 * Product domain types for the WeChat assistant's people, followups, and
 * automations views.
 *
 * Note: a single person can belong to multiple groups (e.g. partner + family).
 */

export type RelationGroup = 'partner' | 'family' | 'friend' | 'colleague';

export const GROUP_ORDER: RelationGroup[] = ['partner', 'family', 'friend', 'colleague'];

export const GROUP_LABEL: Record<RelationGroup, string> = {
  partner: '伴侣',
  family: '家人',
  friend: '朋友',
  colleague: '同事',
};

export interface PersonInteractionDay {
  /** 0 = today, 1 = yesterday, …, 13 = 14 days ago */
  daysAgo: number;
  count: number;
}

export interface PersonRecentTopic {
  word: string;
  count: number;
}

export interface Person {
  id: string;
  wxid: string;
  name: string;
  remark?: string;
  isGroup: boolean;
  groups: RelationGroup[];
  /** AI confidence in proposed groups, 0..1 — used for "is this really 朋友?" suggestions */
  groupConfidence?: Partial<Record<RelationGroup, number>>;
  totalMessages30d: number;
  yourShare30d: number; // 0..1
  lastInteractionTs: number;
  interactionDays: PersonInteractionDay[]; // length 14
  topWords: PersonRecentTopic[];
  /** AI-detected sentiment / tone tags, e.g. ['亲昵', '事务', '情绪低落'] */
  toneTags: string[];
}

export type FollowupType = 'reply' | 'commitment' | 'event' | 'health' | 'other';

export type FollowupStatus = 'open' | 'in_progress' | 'done' | 'archived';

export interface FollowupDialogueRef {
  ts: number;
  who: string;
  text: string;
}

export interface Followup {
  id: string;
  title: string;
  type: FollowupType;
  involvedPersonIds: string[];
  summary: string;
  nextStep: string;
  status: FollowupStatus;
  createdAt: number;
  updatedAt: number;
  dueAt?: number;
  dialogueRefs: FollowupDialogueRef[];
  /** Linked automation ids — the followup may have a "due reminder" + a "weekly check-in" */
  automationIds: string[];
}

export interface SuggestedFollowup {
  /** Stable id so user actions (accept / dismiss) persist across refreshes. */
  id: string;
  draftTitle: string;
  draftType: FollowupType;
  reason: string;
  involvedPersonIds: string[];
  evidenceText: string;
  sourceDisplay?: string | null;
  sourceWxid?: string | null;
  sourceSpeaker?: 'me' | 'them';
  sourceSpeakerName?: string | null;
}

export type AutomationKind = 'reminder_once' | 'reminder_recurring';
export type AutomationRunStatus = 'running' | 'success' | 'error' | 'cancelled' | '';

export interface Automation {
  id: string;
  name: string;
  kind: AutomationKind;
  cron: string;
  /** human-readable cron description, AI-generated */
  cronLabel: string;
  /** What gets executed when it fires */
  action: AutomationAction;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  /** If linked to a followup */
  followupId?: string;
  /** Backing Lumos Workflow schedule id, when this automation is runnable. */
  scheduleId?: string;
  /** Human-readable reason when the rule is saved but not runnable yet. */
  scheduleError?: string;
  /** Recent runtime projection from the backing Workflow schedule. */
  scheduleRunCount?: number;
  lastRunStatus?: AutomationRunStatus;
  lastRunError?: string;
  latestRunId?: string;
}

export type AutomationAction =
  | { kind: 'remind_followup'; followupId: string; messageTemplate: string }
  | { kind: 'recap_person'; personId: string; messageTemplate: string }
  | { kind: 'wechat_summary'; messageTemplate: string }
  | { kind: 'custom'; messageTemplate: string };
