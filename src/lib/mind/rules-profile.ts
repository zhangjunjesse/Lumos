import crypto from 'crypto';
import { getSetting, setSetting } from '@/lib/db';

const PROFILE_KEY = 'mind_rules_profile';
const HISTORY_KEY = 'mind_rules_profile_history';

export interface MindRulesProfile {
  collaborationStyle: string;
  responseRules: string;
  safetyBoundaries: string;
  memoryPolicy: string;
}

export interface MindRulesHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindRulesProfile;
}

const DEFAULT_PROFILE: MindRulesProfile = {
  collaborationStyle: 'Prioritize direct, actionable, and truthful collaboration. Keep responses concise and structured.',
  responseRules: 'State key conclusions first, then give steps. Explicitly call out assumptions and uncertainty.',
  safetyBoundaries: 'Never fabricate facts or claim actions not performed. Refuse unsafe or privacy-invasive requests.',
  memoryPolicy: 'Use persisted memories only when relevant to current intent. Current user instruction always has highest priority.',
};

function normalizeField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 1200);
}

function normalizeProfile(input: Partial<MindRulesProfile>): MindRulesProfile {
  return {
    collaborationStyle: normalizeField(input.collaborationStyle, DEFAULT_PROFILE.collaborationStyle),
    responseRules: normalizeField(input.responseRules, DEFAULT_PROFILE.responseRules),
    safetyBoundaries: normalizeField(input.safetyBoundaries, DEFAULT_PROFILE.safetyBoundaries),
    memoryPolicy: normalizeField(input.memoryPolicy, DEFAULT_PROFILE.memoryPolicy),
  };
}

function readHistory(): MindRulesHistoryItem[] {
  const raw = getSetting(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const obj = item as Partial<MindRulesHistoryItem>;
        const profile = normalizeProfile((obj?.profile || {}) as Partial<MindRulesProfile>);
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

function isSameProfile(a: MindRulesProfile, b: MindRulesProfile): boolean {
  return a.collaborationStyle === b.collaborationStyle
    && a.responseRules === b.responseRules
    && a.safetyBoundaries === b.safetyBoundaries
    && a.memoryPolicy === b.memoryPolicy;
}

export function getMindRulesProfile(): MindRulesProfile {
  const raw = getSetting(PROFILE_KEY);
  if (!raw) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<MindRulesProfile>;
    return normalizeProfile(parsed);
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function getMindRulesHistory(limit = 20): MindRulesHistoryItem[] {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return readHistory().slice(0, safeLimit);
}

export function saveMindRulesProfile(
  next: Partial<MindRulesProfile>,
  source = 'manual',
): MindRulesProfile {
  const previous = getMindRulesProfile();
  const merged = {
    ...previous,
    ...next,
  };
  const normalized = normalizeProfile(merged);

  if (!isSameProfile(previous, normalized)) {
    const item: MindRulesHistoryItem = {
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
