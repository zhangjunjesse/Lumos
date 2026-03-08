import crypto from 'crypto';
import { getSetting, setSetting } from '@/lib/db';

const PROFILE_KEY = 'mind_persona_profile';
const HISTORY_KEY = 'mind_persona_profile_history';

export interface MindPersonaProfile {
  identity: string;
  relationship: string;
  tone: string;
  mission: string;
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
};

function normalizeField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 280);
}

function normalizeProfile(input: Partial<MindPersonaProfile>): MindPersonaProfile {
  return {
    identity: normalizeField(input.identity, DEFAULT_PROFILE.identity),
    relationship: normalizeField(input.relationship, DEFAULT_PROFILE.relationship),
    tone: normalizeField(input.tone, DEFAULT_PROFILE.tone),
    mission: normalizeField(input.mission, DEFAULT_PROFILE.mission),
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
  return a.identity === b.identity
    && a.relationship === b.relationship
    && a.tone === b.tone
    && a.mission === b.mission;
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
