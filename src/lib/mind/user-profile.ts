import crypto from 'crypto';
import { getSetting, setSetting } from '@/lib/db';

const PROFILE_KEY = 'mind_user_profile';
const HISTORY_KEY = 'mind_user_profile_history';

export type MindDecisionDomain =
  | 'engineering'
  | 'product'
  | 'analysis'
  | 'operations'
  | 'manufacturing'
  | 'family'
  | 'education'
  | 'other';

export type MindQualityCriterion =
  | 'accuracy'
  | 'actionability'
  | 'speed'
  | 'risk_control'
  | 'experience'
  | 'cost'
  | 'innovation';

export type MindResponseStructure =
  | 'conclusion_steps'
  | 'option_compare'
  | 'teaching_explain'
  | 'checklist_execute';

export type MindUncertaintyMode =
  | 'slow_precise'
  | 'estimate_then_verify'
  | 'advance_then_calibrate';

export type MindCollaborationCadence =
  | 'confirm_each_step'
  | 'milestone_sync'
  | 'final_summary';

export type MindCustomCategory =
  | 'communication'
  | 'decision'
  | 'boundary'
  | 'trigger'
  | 'aesthetic'
  | 'industry'
  | 'family'
  | 'other';

export interface MindUserCustomPreference {
  id: string;
  category: MindCustomCategory;
  trigger: string;
  expectedAction: string;
  antiPattern: string;
  priority: number; // 1..5
  force: boolean;
  enabled: boolean;
}

export interface MindUserProfile {
  preferredName: string;
  longTermIdentity: string;
  primaryDecisionDomains: MindDecisionDomain[];
  qualityCriteriaOrder: MindQualityCriterion[];
  responseStructure: MindResponseStructure;
  uncertaintyMode: MindUncertaintyMode;
  collaborationCadence: MindCollaborationCadence;
  hardBoundaries: string[];
  pressureSignals: string[];
  aestheticStandards: string[];
  customPreferences: MindUserCustomPreference[];
}

export interface MindUserHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindUserProfile;
}

const DEFAULT_PROFILE: MindUserProfile = {
  preferredName: '你',
  longTermIdentity: '长期从事复杂问题解决，追求高质量与长期价值。',
  primaryDecisionDomains: ['engineering', 'product', 'analysis'],
  qualityCriteriaOrder: ['actionability', 'accuracy', 'experience'],
  responseStructure: 'conclusion_steps',
  uncertaintyMode: 'estimate_then_verify',
  collaborationCadence: 'milestone_sync',
  hardBoundaries: ['不要空泛解释', '不允许伪造执行结果', '风险必须明确提示'],
  pressureSignals: ['为什么总是', '不对', '卡住了'],
  aestheticStandards: ['克制', '清晰', '有层次'],
  customPreferences: [],
};

const DECISION_DOMAIN_OPTIONS: MindDecisionDomain[] = [
  'engineering',
  'product',
  'analysis',
  'operations',
  'manufacturing',
  'family',
  'education',
  'other',
];
const QUALITY_CRITERIA_OPTIONS: MindQualityCriterion[] = [
  'accuracy',
  'actionability',
  'speed',
  'risk_control',
  'experience',
  'cost',
  'innovation',
];
const RESPONSE_STRUCTURE_OPTIONS: MindResponseStructure[] = [
  'conclusion_steps',
  'option_compare',
  'teaching_explain',
  'checklist_execute',
];
const UNCERTAINTY_MODE_OPTIONS: MindUncertaintyMode[] = [
  'slow_precise',
  'estimate_then_verify',
  'advance_then_calibrate',
];
const COLLAB_CADENCE_OPTIONS: MindCollaborationCadence[] = [
  'confirm_each_step',
  'milestone_sync',
  'final_summary',
];
const CUSTOM_CATEGORY_OPTIONS: MindCustomCategory[] = [
  'communication',
  'decision',
  'boundary',
  'trigger',
  'aesthetic',
  'industry',
  'family',
  'other',
];

function normalizeText(value: unknown, fallback: string, max = 280): string {
  if (typeof value !== 'string') return fallback.slice(0, max);
  const trimmed = value.trim();
  if (!trimmed) return fallback.slice(0, max);
  return trimmed.slice(0, max);
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStringList(value: unknown, fallback: string[], maxItems = 10, maxLen = 80): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；]/)
      : [];
  const unique = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized) continue;
    unique.add(normalized.slice(0, maxLen));
    if (unique.size >= maxItems) break;
  }
  if (unique.size === 0) return fallback.slice(0, maxItems);
  return Array.from(unique);
}

function normalizeEnumList<T extends string>(
  value: unknown,
  fallback: T[],
  options: T[],
  minItems: number,
  maxItems: number,
): T[] {
  const normalizedRaw = normalizeStringList(value, fallback as unknown as string[], maxItems, 48)
    .map((item) => item.toLowerCase() as T);
  const unique = new Set<T>();
  for (const item of normalizedRaw) {
    if (!options.includes(item)) continue;
    unique.add(item);
    if (unique.size >= maxItems) break;
  }
  if (unique.size < minItems) {
    for (const item of fallback) {
      if (options.includes(item)) unique.add(item);
      if (unique.size >= minItems) break;
    }
  }
  return Array.from(unique).slice(0, maxItems);
}

function normalizeEnumValue<T extends string>(value: unknown, fallback: T, options: T[]): T {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase() as T;
  if (!options.includes(normalized)) return fallback;
  return normalized;
}

function normalizePriority(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(1, Math.min(5, rounded));
}

function normalizeCustomItem(input: unknown): MindUserCustomPreference | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Partial<MindUserCustomPreference>;
  const trigger = normalizeText(raw.trigger, '', 180);
  const expectedAction = normalizeText(raw.expectedAction, '', 220);
  const antiPattern = normalizeText(raw.antiPattern, '', 220);
  if (!trigger || !expectedAction) return null;
  const id = normalizeText(raw.id, '', 48) || crypto.randomBytes(8).toString('hex');
  return {
    id,
    category: normalizeEnumValue(raw.category, 'other', CUSTOM_CATEGORY_OPTIONS),
    trigger,
    expectedAction,
    antiPattern,
    priority: normalizePriority(raw.priority, 3),
    force: normalizeBool(raw.force, false),
    enabled: normalizeBool(raw.enabled, true),
  };
}

function splitLegacyList(value: string, maxItems = 8): string[] {
  return normalizeStringList(value, [], maxItems, 80);
}

function fromLegacy(input: Record<string, unknown>): Partial<MindUserProfile> {
  const summary = typeof input.summary === 'string' ? input.summary : '';
  const preferences = typeof input.preferences === 'string' ? input.preferences : '';
  const boundaries = typeof input.boundaries === 'string' ? input.boundaries : '';
  return {
    preferredName: '你',
    longTermIdentity: summary || DEFAULT_PROFILE.longTermIdentity,
    hardBoundaries: splitLegacyList(boundaries, 8),
    aestheticStandards: splitLegacyList(preferences, 6),
    pressureSignals: DEFAULT_PROFILE.pressureSignals,
  };
}

function normalizeProfile(input: Partial<MindUserProfile> & Record<string, unknown>): MindUserProfile {
  const merged = ('summary' in input || 'preferences' in input || 'boundaries' in input)
    ? { ...fromLegacy(input), ...input }
    : input;
  const customItemsRaw = Array.isArray(merged.customPreferences) ? merged.customPreferences : [];
  const customPreferences = customItemsRaw
    .map((item) => normalizeCustomItem(item))
    .filter((item): item is MindUserCustomPreference => Boolean(item))
    .slice(0, 60);

  return {
    preferredName: normalizeText(merged.preferredName, DEFAULT_PROFILE.preferredName, 32),
    longTermIdentity: normalizeText(merged.longTermIdentity, DEFAULT_PROFILE.longTermIdentity, 360),
    primaryDecisionDomains: normalizeEnumList(
      merged.primaryDecisionDomains,
      DEFAULT_PROFILE.primaryDecisionDomains,
      DECISION_DOMAIN_OPTIONS,
      1,
      3,
    ),
    qualityCriteriaOrder: normalizeEnumList(
      merged.qualityCriteriaOrder,
      DEFAULT_PROFILE.qualityCriteriaOrder,
      QUALITY_CRITERIA_OPTIONS,
      1,
      3,
    ),
    responseStructure: normalizeEnumValue(
      merged.responseStructure,
      DEFAULT_PROFILE.responseStructure,
      RESPONSE_STRUCTURE_OPTIONS,
    ),
    uncertaintyMode: normalizeEnumValue(
      merged.uncertaintyMode,
      DEFAULT_PROFILE.uncertaintyMode,
      UNCERTAINTY_MODE_OPTIONS,
    ),
    collaborationCadence: normalizeEnumValue(
      merged.collaborationCadence,
      DEFAULT_PROFILE.collaborationCadence,
      COLLAB_CADENCE_OPTIONS,
    ),
    hardBoundaries: normalizeStringList(merged.hardBoundaries, DEFAULT_PROFILE.hardBoundaries, 10, 90),
    pressureSignals: normalizeStringList(merged.pressureSignals, DEFAULT_PROFILE.pressureSignals, 10, 48),
    aestheticStandards: normalizeStringList(merged.aestheticStandards, DEFAULT_PROFILE.aestheticStandards, 10, 64),
    customPreferences,
  };
}

function isSameProfile(a: MindUserProfile, b: MindUserProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readHistory(): MindUserHistoryItem[] {
  const raw = getSetting(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const obj = item as Partial<MindUserHistoryItem>;
        const profile = normalizeProfile((obj?.profile || {}) as Partial<MindUserProfile> & Record<string, unknown>);
        const id = typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : crypto.randomBytes(8).toString('hex');
        const savedAt = typeof obj.saved_at === 'string' && obj.saved_at.trim()
          ? obj.saved_at.trim()
          : new Date().toISOString();
        const source = typeof obj.source === 'string' && obj.source.trim()
          ? obj.source.trim().slice(0, 80)
          : 'manual';
        return {
          id,
          saved_at: savedAt,
          source,
          profile,
        };
      })
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function getMindUserProfile(): MindUserProfile {
  const raw = getSetting(PROFILE_KEY);
  if (!raw) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<MindUserProfile> & Record<string, unknown>;
    return normalizeProfile(parsed);
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function getMindUserHistory(limit = 20): MindUserHistoryItem[] {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return readHistory().slice(0, safeLimit);
}

export function saveMindUserProfile(next: Partial<MindUserProfile>, source = 'manual'): MindUserProfile {
  const previous = getMindUserProfile();
  const merged = {
    ...previous,
    ...next,
  };
  const normalized = normalizeProfile(merged);

  if (!isSameProfile(previous, normalized)) {
    const item: MindUserHistoryItem = {
      id: crypto.randomBytes(8).toString('hex'),
      saved_at: new Date().toISOString(),
      source: source.trim().slice(0, 80) || 'manual',
      profile: previous,
    };
    const history = [item, ...readHistory()].slice(0, 80);
    setSetting(HISTORY_KEY, JSON.stringify(history));
  }

  setSetting(PROFILE_KEY, JSON.stringify(normalized));
  return normalized;
}
