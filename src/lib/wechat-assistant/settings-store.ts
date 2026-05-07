import { getSetting, setSetting } from '@/lib/db';

import type { AppSettings } from '@/components/apps/builtin/wechat/app-settings';

import { mergeWithDefaults, validateSettings } from './settings-merge';

const STORAGE_KEY = 'apps.wechat-assistant.settings.v1';

export { SettingsValidationError } from './settings-merge';

export function getWeChatAssistantSettings(): AppSettings {
  const raw = getSetting(STORAGE_KEY);
  if (!raw) return mergeWithDefaults(undefined);
  try {
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return mergeWithDefaults(undefined);
  }
}

export function updateWeChatAssistantSettings(input: unknown): AppSettings {
  const next = validateSettings(input);
  setSetting(STORAGE_KEY, JSON.stringify(next));
  return next;
}
