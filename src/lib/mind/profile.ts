import crypto from 'crypto';
import { getSetting, setSetting } from '@/lib/db';

const PROFILE_KEY = 'mind_persona_profile';
const HISTORY_KEY = 'mind_persona_profile_history';

export type MindRoleMode = 'assistant' | 'advisor' | 'coach';
export type MindProactivityMode = 'passive' | 'balanced' | 'proactive';
export type MindChallengeLevel = 'compliant' | 'gentle' | 'strong';
export type MindRiskStyle = 'conservative' | 'balanced' | 'aggressive';
export type MindMemoryStyle = 'strict' | 'balanced' | 'active';
export type MindPolicyCategory =
  | 'workflow'
  | 'risk'
  | 'communication'
  | 'memory'
  | 'safety'
  | 'other';

export interface MindPersonaCustomPolicy {
  id: string;
  category: MindPolicyCategory;
  trigger: string;
  expectedAction: string;
  antiPattern: string;
  priority: number;
  force: boolean;
  enabled: boolean;
}

export interface MindPersonaProfile {
  identity: string;
  relationship: string;
  tone: string;
  mission: string;
  roleMode: MindRoleMode;
  proactivity: MindProactivityMode;
  challengeLevel: MindChallengeLevel;
  riskStyle: MindRiskStyle;
  memoryStyle: MindMemoryStyle;
  customPolicies: MindPersonaCustomPolicy[];
}

export interface MindPersonaHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindPersonaProfile;
}

const DEFAULT_PROFILE: MindPersonaProfile = {
  identity: 'Lumos',
  relationship: 'A reliable companion that remembers what matters.',
  tone: 'Warm, direct, and practical.',
  mission: 'Help the user build, decide, and evolve with continuity.',
  roleMode: 'advisor',
  proactivity: 'balanced',
  challengeLevel: 'gentle',
  riskStyle: 'balanced',
  memoryStyle: 'balanced',
  customPolicies: [],
};

function normalizeField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 280);
}

const ROLE_MODE_OPTIONS: MindRoleMode[] = ['assistant', 'advisor', 'coach'];
const PROACTIVITY_OPTIONS: MindProactivityMode[] = ['passive', 'balanced', 'proactive'];
const CHALLENGE_OPTIONS: MindChallengeLevel[] = ['compliant', 'gentle', 'strong'];
const RISK_STYLE_OPTIONS: MindRiskStyle[] = ['conservative', 'balanced', 'aggressive'];
const MEMORY_STYLE_OPTIONS: MindMemoryStyle[] = ['strict', 'balanced', 'active'];
const POLICY_CATEGORY_OPTIONS: MindPolicyCategory[] = [
  'workflow',
  'risk',
  'communication',
  'memory',
  'safety',
  'other',
];

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

function normalizeEnum<T extends string>(value: unknown, fallback: T, options: T[]): T {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase() as T;
  return options.includes(normalized) ? normalized : fallback;
}

function normalizePriority(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(1, Math.min(5, rounded));
}

function normalizePolicy(input: unknown): MindPersonaCustomPolicy | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Partial<MindPersonaCustomPolicy>;
  const trigger = normalizeField(raw.trigger, '').slice(0, 180);
  const expectedAction = normalizeField(raw.expectedAction, '').slice(0, 220);
  const antiPattern = normalizeField(raw.antiPattern, '').slice(0, 220);
  if (!trigger || !expectedAction) return null;
  return {
    id: normalizeField(raw.id, '').slice(0, 48) || crypto.randomBytes(8).toString('hex'),
    category: normalizeEnum(raw.category, 'other', POLICY_CATEGORY_OPTIONS),
    trigger,
    expectedAction,
    antiPattern,
    priority: normalizePriority(raw.priority, 3),
    force: normalizeBool(raw.force, false),
    enabled: normalizeBool(raw.enabled, true),
  };
}

function normalizeProfile(input: Partial<MindPersonaProfile>): MindPersonaProfile {
  const customPoliciesRaw = Array.isArray(input.customPolicies) ? input.customPolicies : [];
  return {
    identity: normalizeField(input.identity, DEFAULT_PROFILE.identity),
    relationship: normalizeField(input.relationship, DEFAULT_PROFILE.relationship),
    tone: normalizeField(input.tone, DEFAULT_PROFILE.tone),
    mission: normalizeField(input.mission, DEFAULT_PROFILE.mission),
    roleMode: normalizeEnum(input.roleMode, DEFAULT_PROFILE.roleMode, ROLE_MODE_OPTIONS),
    proactivity: normalizeEnum(input.proactivity, DEFAULT_PROFILE.proactivity, PROACTIVITY_OPTIONS),
    challengeLevel: normalizeEnum(input.challengeLevel, DEFAULT_PROFILE.challengeLevel, CHALLENGE_OPTIONS),
    riskStyle: normalizeEnum(input.riskStyle, DEFAULT_PROFILE.riskStyle, RISK_STYLE_OPTIONS),
    memoryStyle: normalizeEnum(input.memoryStyle, DEFAULT_PROFILE.memoryStyle, MEMORY_STYLE_OPTIONS),
    customPolicies: customPoliciesRaw
      .map((item) => normalizePolicy(item))
      .filter((item): item is MindPersonaCustomPolicy => Boolean(item))
      .slice(0, 60),
  };
}

function readHistory(): MindPersonaHistoryItem[] {
  const raw = getSetting(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const obj = item as Partial<MindPersonaHistoryItem>;
        const profile = normalizeProfile((obj?.profile || {}) as Partial<MindPersonaProfile>);
        const savedAt = typeof obj.saved_at === 'string' && obj.saved_at.trim()
          ? obj.saved_at.trim()
          : new Date().toISOString();
        const source = typeof obj.source === 'string' && obj.source.trim()
          ? obj.source.trim().slice(0, 80)
          : 'manual';
        const id = typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : crypto.randomBytes(8).toString('hex');
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

function isSameProfile(a: MindPersonaProfile, b: MindPersonaProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function getMindPersonaProfile(): MindPersonaProfile {
  const raw = getSetting(PROFILE_KEY);
  if (!raw) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<MindPersonaProfile>;
    return normalizeProfile(parsed);
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function getMindPersonaHistory(limit = 20): MindPersonaHistoryItem[] {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return readHistory().slice(0, safeLimit);
}

export function saveMindPersonaProfile(
  next: Partial<MindPersonaProfile>,
  source = 'manual',
): MindPersonaProfile {
  const previous = getMindPersonaProfile();
  const merged = {
    ...previous,
    ...next,
  };
  const normalized = normalizeProfile(merged);

  if (!isSameProfile(previous, normalized)) {
    const item: MindPersonaHistoryItem = {
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
