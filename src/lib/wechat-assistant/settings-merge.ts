import { z } from 'zod';

import type { AppSettings } from '@/components/apps/builtin/wechat/app-settings';
import { DEFAULT_SETTINGS } from '@/components/apps/builtin/wechat/app-settings';
import { DEFAULT_PROMPTS } from '@/components/apps/builtin/wechat/default-prompts';

const promptsPartial = z
  .object({
    assistantChat: z.string(),
    followupExtractor: z.string(),
    dailyReporter: z.string(),
    summarizer: z.string(),
    matcher: z.string(),
    customReportRouter: z.string(),
    topicExtractor: z.string(),
  })
  .partial();

const inputSchema = z
  .object({
    ai: z
      .object({
        providerId: z.string().nullable().default(null),
        model: z.string().nullable().default(null),
        windowDays: z
          .union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)])
          .default(14),
        schedule: z.enum(['manual', 'daily', 'every_4h']).default('manual'),
        sensitivity: z.enum(['strict', 'balanced', 'loose']).default('balanced'),
        prompts: promptsPartial.default({}),
      })
      .partial()
      .default({}),
    overview: z
      .object({
        showInteractionRank: z.boolean().default(true),
        showHeatmap: z.boolean().default(true),
        showTopics: z.boolean().default(true),
      })
      .partial()
      .default({}),
    notifications: z
      .object({
        proactiveEnabled: z.boolean().default(false),
        channels: z
          .array(z.enum(['desktop', 'wechat_im', 'feishu', 'email']))
          .default(['desktop']),
      })
      .partial()
      .default({}),
    excludedPersonIds: z.array(z.string()).default([]),
    topicAnalysis: z
      .object({
        whitelistPersonal: z.array(z.string()).default([]),
        whitelistGroups: z.array(z.string()).default([]),
        maxMessagesPerCall: z
          .union([z.literal(200), z.literal(500), z.literal(1000), z.literal(2000)])
          .default(500),
        minChatMessages: z
          .union([z.literal(5), z.literal(10), z.literal(20), z.literal(50)])
          .default(10),
      })
      .partial()
      .default({}),
    followups: z
      .object({
        defaultReminderHour: z.number().int().min(0).max(23).default(9),
      })
      .partial()
      .default({}),
  })
  .partial();

export class SettingsValidationError extends Error {
  constructor(public readonly issues: string) {
    super(`Invalid wechat-assistant settings: ${issues}`);
    this.name = 'SettingsValidationError';
  }
}

/**
 * Merge a partial / loosely-typed input on top of DEFAULT_SETTINGS.
 * Always returns a full AppSettings — every leaf is defined and prompts has every known key.
 */
export function mergeWithDefaults(input: unknown): AppSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return cloneDefaults();
  }
  const parsed = inputSchema.safeParse(input);
  const partial = (parsed.success ? parsed.data : {}) as Partial<AppSettings>;
  const merged = deepMerge(cloneDefaults(), partial);
  merged.ai.prompts = { ...DEFAULT_PROMPTS, ...merged.ai.prompts };
  return merged;
}

/**
 * Fully validate; throws SettingsValidationError on schema breach.
 * Unlike `mergeWithDefaults`, this does NOT silently swallow bad input —
 * it surfaces validation issues so the API layer can return 400.
 */
export function validateSettings(input: unknown): AppSettings {
  if (input === undefined || input === null) {
    return cloneDefaultsWithFreshPrompts();
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new SettingsValidationError('input must be an object');
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new SettingsValidationError(formatIssues(parsed.error.issues));
  }
  const merged = deepMerge(cloneDefaults(), parsed.data as Partial<AppSettings>);
  merged.ai.prompts = { ...DEFAULT_PROMPTS, ...merged.ai.prompts };
  return merged;
}

function cloneDefaultsWithFreshPrompts(): AppSettings {
  const out = cloneDefaults();
  out.ai.prompts = { ...DEFAULT_PROMPTS };
  return out;
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => `${i.path.map(String).join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}

function cloneDefaults(): AppSettings {
  return {
    ai: {
      ...DEFAULT_SETTINGS.ai,
      prompts: { ...DEFAULT_SETTINGS.ai.prompts },
    },
    overview: { ...DEFAULT_SETTINGS.overview },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      channels: [...DEFAULT_SETTINGS.notifications.channels],
    },
    excludedPersonIds: [...DEFAULT_SETTINGS.excludedPersonIds],
    topicAnalysis: {
      ...DEFAULT_SETTINGS.topicAnalysis,
      whitelistPersonal: [...DEFAULT_SETTINGS.topicAnalysis.whitelistPersonal],
      whitelistGroups: [...DEFAULT_SETTINGS.topicAnalysis.whitelistGroups],
    },
    followups: { ...DEFAULT_SETTINGS.followups },
  };
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (
    base === null ||
    typeof base !== 'object' ||
    Array.isArray(base) ||
    patch === null ||
    typeof patch !== 'object' ||
    Array.isArray(patch)
  ) {
    return (patch ?? base) as T;
  }
  const baseRec = base as Record<string, unknown>;
  const patchRec = patch as Record<string, unknown>;
  const out: Record<string, unknown> = { ...baseRec };
  for (const [key, value] of Object.entries(patchRec)) {
    if (value === undefined) continue;
    const baseVal = baseRec[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      out[key] = deepMerge(baseVal, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
