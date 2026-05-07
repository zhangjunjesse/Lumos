import type { ApiProvider } from '@/types';

const getSettingMock = jest.fn();
const getProviderMock = jest.fn();
const getDefaultProviderMock = jest.fn();
const getAllProvidersMock = jest.fn();

jest.mock('@/lib/db', () => ({
  getAllProviders: (...args: unknown[]) => getAllProvidersMock(...args),
  getDefaultProvider: (...args: unknown[]) => getDefaultProviderMock(...args),
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

jest.mock('@/lib/db/sessions', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

import {
  listAppBuilderProviderModelGroups,
  resolveAppBuilderProviderAndModel,
} from '../app-builder-session';

function provider(overrides: Partial<ApiProvider>): ApiProvider {
  return {
    id: overrides.id || 'provider-1',
    name: overrides.name || 'Provider',
    provider_type: overrides.provider_type || 'anthropic',
    api_protocol: overrides.api_protocol || 'anthropic-messages',
    capabilities: overrides.capabilities || '["text-gen"]',
    provider_origin: overrides.provider_origin || 'custom',
    auth_mode: overrides.auth_mode || 'api_key',
    base_url: overrides.base_url || 'https://api.example.com',
    api_key: overrides.api_key ?? 'sk-test',
    is_active: overrides.is_active ?? 0,
    sort_order: overrides.sort_order ?? 0,
    extra_env: overrides.extra_env || '{}',
    model_catalog: overrides.model_catalog || JSON.stringify([{ value: 'model-a', label: 'Model A' }]),
    model_catalog_source: overrides.model_catalog_source || 'manual',
    model_catalog_updated_at: overrides.model_catalog_updated_at ?? null,
    notes: overrides.notes || '',
    is_builtin: overrides.is_builtin ?? 0,
    user_modified: overrides.user_modified ?? 0,
    created_at: overrides.created_at || '2026-05-03 00:00:00',
    updated_at: overrides.updated_at || '2026-05-03 00:00:00',
  };
}

describe('app builder provider resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSettingMock.mockReturnValue('');
  });

  test('falls back from local_auth to the default non-local text provider', () => {
    const localAuth = provider({
      id: 'local',
      name: '本地',
      auth_mode: 'local_auth',
      capabilities: '["agent-chat","text-gen"]',
    });
    const defaultChat = provider({
      id: 'chat',
      name: 'DeepSeek',
      capabilities: '["agent-chat"]',
    });
    const textGen = provider({
      id: 'text',
      name: '通义千问',
      api_protocol: 'openai-compatible',
      capabilities: '["text-gen"]',
      model_catalog: JSON.stringify([{ value: 'qwen3-plus', label: 'Qwen3 Plus' }]),
    });

    getProviderMock.mockReturnValue(localAuth);
    getDefaultProviderMock.mockReturnValue(defaultChat);
    getAllProvidersMock.mockReturnValue([localAuth, defaultChat, textGen]);

    expect(resolveAppBuilderProviderAndModel({ providerId: 'local' })).toEqual({
      providerId: 'chat',
      model: 'model-a',
    });
  });

  test('provider model groups only expose usable app builder providers', () => {
    const localAuth = provider({ id: 'local', auth_mode: 'local_auth' });
    const missingKey = provider({ id: 'missing-key', api_key: '', extra_env: '{}' });
    const textGen = provider({ id: 'text', name: '通义千问' });

    getDefaultProviderMock.mockReturnValue(localAuth);
    getAllProvidersMock.mockReturnValue([localAuth, missingKey, textGen]);

    expect(listAppBuilderProviderModelGroups()).toMatchObject({
      default_provider_id: 'text',
      groups: [
        {
          provider_id: 'text',
          provider_name: '通义千问',
          models: [{ value: 'model-a', label: 'Model A' }],
        },
      ],
    });
  });
});
