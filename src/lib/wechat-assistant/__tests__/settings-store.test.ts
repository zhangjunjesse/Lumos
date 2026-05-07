import {
  SettingsValidationError,
  mergeWithDefaults,
  validateSettings,
} from '../settings-merge';
import { DEFAULT_SETTINGS } from '@/components/apps/builtin/wechat/app-settings';
import { DEFAULT_PROMPTS } from '@/components/apps/builtin/wechat/default-prompts';

describe('mergeWithDefaults', () => {
  it('returns full defaults when input is empty / wrong shape', () => {
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeWithDefaults('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(mergeWithDefaults([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(mergeWithDefaults({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps user-set fields and defaults the rest', () => {
    const out = mergeWithDefaults({
      ai: { sensitivity: 'loose', windowDays: 30 },
      overview: { showHeatmap: false },
    });
    expect(out.ai.sensitivity).toBe('loose');
    expect(out.ai.windowDays).toBe(30);
    expect(out.ai.providerId).toBeNull();
    expect(out.ai.schedule).toBe('manual');
    expect(out.overview.showHeatmap).toBe(false);
    expect(out.overview.showTopics).toBe(true);
    expect(out.followups.defaultReminderHour).toBe(9);
    expect(out.topicAnalysis.whitelistPersonal).toEqual([]);
    expect(out.topicAnalysis.whitelistGroups).toEqual([]);
    expect(out.topicAnalysis.maxMessagesPerCall).toBe(500);
    expect(out.topicAnalysis.minChatMessages).toBe(10);
  });

  it('back-fills all prompt keys when user only stored some', () => {
    const out = mergeWithDefaults({
      ai: { prompts: { followupExtractor: 'CUSTOM' } },
    });
    expect(out.ai.prompts.followupExtractor).toBe('CUSTOM');
    expect(out.ai.prompts.dailyReporter).toBe(DEFAULT_PROMPTS.dailyReporter);
    expect(out.ai.prompts.summarizer).toBe(DEFAULT_PROMPTS.summarizer);
    expect(out.ai.prompts.matcher).toBe(DEFAULT_PROMPTS.matcher);
    expect(out.ai.prompts.customReportRouter).toBe(DEFAULT_PROMPTS.customReportRouter);
    expect(out.ai.prompts.topicExtractor).toBe(DEFAULT_PROMPTS.topicExtractor);
    expect(out.ai.prompts.assistantChat).toBe(DEFAULT_PROMPTS.assistantChat);
  });

  it('persists topic extractor and assistant chat prompts instead of stripping them during validation', () => {
    const result = validateSettings({
      ai: {
        prompts: {
          assistantChat: 'CUSTOM ASSISTANT PROMPT',
          topicExtractor: 'CUSTOM TOPIC PROMPT',
          dailyReporter: 'CUSTOM DAILY REPORT PROMPT',
        },
      },
    });

    expect(result.ai.prompts.assistantChat).toBe('CUSTOM ASSISTANT PROMPT');
    expect(result.ai.prompts.topicExtractor).toBe('CUSTOM TOPIC PROMPT');
    expect(result.ai.prompts.dailyReporter).toBe('CUSTOM DAILY REPORT PROMPT');
    expect(result.ai.prompts.followupExtractor).toBe(DEFAULT_PROMPTS.followupExtractor);
  });

  it('replaces array fields wholesale (does not merge)', () => {
    const out = mergeWithDefaults({
      excludedPersonIds: ['wxid_a'],
      notifications: { channels: ['feishu', 'email'] },
    });
    expect(out.excludedPersonIds).toEqual(['wxid_a']);
    expect(out.notifications.channels).toEqual(['feishu', 'email']);
  });

  it('drops invalid enum values silently and falls back to defaults', () => {
    const out = mergeWithDefaults({
      ai: { sensitivity: 'extreme', windowDays: 9999 },
    });
    expect(out.ai.sensitivity).toBe(DEFAULT_SETTINGS.ai.sensitivity);
    expect(out.ai.windowDays).toBe(DEFAULT_SETTINGS.ai.windowDays);
  });

  it('does not mutate DEFAULT_SETTINGS', () => {
    mergeWithDefaults({
      excludedPersonIds: ['a'],
      ai: { prompts: { summarizer: 'X' } },
    });
    expect(DEFAULT_SETTINGS.excludedPersonIds).toEqual([]);
    expect(DEFAULT_SETTINGS.ai.prompts.summarizer).toBe(DEFAULT_PROMPTS.summarizer);
  });
});

describe('validateSettings', () => {
  it('passes a valid full settings object', () => {
    const result = validateSettings(DEFAULT_SETTINGS);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it('throws SettingsValidationError on out-of-range numbers', () => {
    expect(() =>
      validateSettings({
        followups: { defaultReminderHour: 99 },
      }),
    ).toThrow(SettingsValidationError);
  });

  it('accepts an empty object and returns defaults', () => {
    const result = validateSettings({});
    expect(result).toEqual(DEFAULT_SETTINGS);
  });
});
