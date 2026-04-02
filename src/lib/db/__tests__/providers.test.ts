import type { ApiProvider } from '@/types';

type MockState = {
  providers: Map<string, ApiProvider>;
  settings: Map<string, string>;
  sessionCounts: Map<string, number>;
  queries: string[];
  runCalls: Array<{ sql: string; args: unknown[] }>;
};

let mockDb: ReturnType<typeof createMockDb>;

jest.mock('../connection', () => ({
  getDb: () => mockDb,
}));

import {
  createProvider as createProviderRecord,
  activateProvider,
  getDefaultProvider,
  resetBuiltinProvider,
  updateProvider,
  ProviderValidationError,
  ProviderActivationBlockedError,
  ProviderUpdateBlockedError,
} from '../providers';

function createProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: overrides.id || 'provider-1',
    name: overrides.name || 'Provider 1',
    provider_type: overrides.provider_type || 'anthropic',
    api_protocol: overrides.api_protocol || 'anthropic-messages',
    capabilities: overrides.capabilities || '["agent-chat"]',
    provider_origin: overrides.provider_origin || 'custom',
    auth_mode: overrides.auth_mode || 'api_key',
    base_url: overrides.base_url || 'https://api.anthropic.com',
    api_key: overrides.api_key || 'sk-test',
    is_active: overrides.is_active ?? 0,
    sort_order: overrides.sort_order ?? 0,
    extra_env: overrides.extra_env || '{}',
    model_catalog: overrides.model_catalog || '[]',
    model_catalog_source: overrides.model_catalog_source || 'default',
    model_catalog_updated_at: overrides.model_catalog_updated_at ?? null,
    notes: overrides.notes || '',
    is_builtin: overrides.is_builtin ?? 0,
    user_modified: overrides.user_modified ?? 0,
    created_at: overrides.created_at || '2026-03-25 00:00:00',
    updated_at: overrides.updated_at || '2026-03-25 00:00:00',
  };
}

function createMockDb(state: MockState) {
  return {
    prepare: jest.fn((sql: string) => {
      state.queries.push(sql);
      return {
        get: (...args: unknown[]) => {
          if (sql.includes("SELECT value FROM settings WHERE key = 'default_provider_id'")) {
            const value = state.settings.get('default_provider_id');
            return value ? { value } : undefined;
          }

          if (sql.includes('SELECT value FROM settings WHERE key = ?')) {
            const value = state.settings.get(String(args[0] || ''));
            return value ? { value } : undefined;
          }

          if (sql.includes('SELECT * FROM api_providers WHERE id = ?')) {
            return state.providers.get(String(args[0] || ''));
          }

          if (sql.includes('SELECT * FROM api_providers WHERE is_builtin = 1 LIMIT 1')) {
            return Array.from(state.providers.values()).find((provider) => provider.is_builtin === 1);
          }

          if (sql.includes('SELECT * FROM api_providers WHERE is_active = 1 LIMIT 1')) {
            return Array.from(state.providers.values()).find((provider) => provider.is_active === 1);
          }

          if (sql.includes('SELECT COUNT(*) as count FROM chat_sessions WHERE provider_id = ?')) {
            return { count: state.sessionCounts.get(String(args[0] || '')) || 0 };
          }

          if (sql.includes('SELECT MAX(sort_order) as max_order FROM api_providers')) {
            const maxOrder = Math.max(-1, ...Array.from(state.providers.values()).map((provider) => provider.sort_order));
            return { max_order: maxOrder };
          }

          return undefined;
        },
        all: (...args: unknown[]) => {
          if (sql.includes("SELECT key FROM settings WHERE value = ? AND key LIKE 'provider_override:%'")) {
            const providerId = String(args[0] || '');
            return Array.from(state.settings.entries())
              .filter(([key, value]) => key.startsWith('provider_override:') && value === providerId)
              .map(([key]) => ({ key }));
          }

          if (sql.includes('SELECT * FROM api_providers ORDER BY sort_order ASC, created_at ASC')) {
            return Array.from(state.providers.values()).sort((a, b) => a.sort_order - b.sort_order);
          }

          return [];
        },
        run: (...args: unknown[]) => {
          state.runCalls.push({ sql, args });

          if (sql.startsWith('INSERT INTO settings')) {
            state.settings.set(String(args[0]), String(args[1]));
            return { changes: 1 };
          }

          if (sql.startsWith('INSERT INTO api_providers')) {
            const provider: ApiProvider = {
              id: String(args[0]),
              name: String(args[1]),
              provider_type: String(args[2]),
              api_protocol: args[3] as ApiProvider['api_protocol'],
              capabilities: String(args[4]),
              provider_origin: args[5] as ApiProvider['provider_origin'],
              auth_mode: args[6] as ApiProvider['auth_mode'],
              base_url: String(args[7]),
              api_key: String(args[8]),
              is_active: Number(args[9]),
              sort_order: Number(args[10]),
              extra_env: String(args[11]),
              model_catalog: String(args[12]),
              model_catalog_source: args[13] as ApiProvider['model_catalog_source'],
              model_catalog_updated_at: (args[14] as string | null) ?? null,
              notes: String(args[15]),
              is_builtin: Number(args[16]),
              user_modified: Number(args[17]),
              created_at: String(args[18]),
              updated_at: String(args[19]),
            };
            state.providers.set(provider.id, provider);
            return { changes: 1 };
          }

          if (sql.startsWith('DELETE FROM settings WHERE key = ?')) {
            state.settings.delete(String(args[0]));
            return { changes: 1 };
          }

          if (sql === 'UPDATE api_providers SET is_active = 0') {
            for (const provider of state.providers.values()) {
              provider.is_active = 0;
            }
            return { changes: state.providers.size };
          }

          if (sql === 'UPDATE api_providers SET is_active = 1 WHERE id = ?') {
            const provider = state.providers.get(String(args[0]));
            if (provider) provider.is_active = 1;
            return { changes: provider ? 1 : 0 };
          }

          if (sql.startsWith('UPDATE api_providers SET name = ?')) {
            const id = String(args[args.length - 1]);
            const provider = state.providers.get(id);
            if (provider) {
              provider.name = String(args[0]);
              provider.provider_type = String(args[1]);
              provider.api_protocol = args[2] as ApiProvider['api_protocol'];
              provider.capabilities = String(args[3]);
              provider.provider_origin = args[4] as ApiProvider['provider_origin'];
              provider.auth_mode = args[5] as ApiProvider['auth_mode'];
              provider.base_url = String(args[6]);
              provider.api_key = String(args[7]);
              provider.extra_env = String(args[8]);
              provider.model_catalog = String(args[9]);
              provider.model_catalog_source = args[10] as ApiProvider['model_catalog_source'];
              provider.model_catalog_updated_at = (args[11] as string | null) ?? null;
              provider.notes = String(args[12]);
              if (args.length === 18) {
                provider.sort_order = Number(args[13]);
                provider.is_active = Number(args[14]);
                provider.user_modified = Number(args[15]);
                provider.updated_at = String(args[16]);
              } else {
                provider.user_modified = Number(args[13]);
                provider.updated_at = String(args[14]);
              }
            }
            return { changes: provider ? 1 : 0 };
          }

          if (sql.startsWith('DELETE FROM api_providers WHERE id = ?')) {
            const existed = state.providers.delete(String(args[0]));
            return { changes: existed ? 1 : 0 };
          }

          return { changes: 1 };
        },
      };
    }),
    transaction: (fn: () => void) => () => fn(),
  };
}

function createState(params?: {
  providers?: ApiProvider[];
  settings?: Record<string, string>;
  sessionCounts?: Record<string, number>;
}): MockState {
  return {
    providers: new Map((params?.providers || []).map((provider) => [provider.id, { ...provider }])),
    settings: new Map(Object.entries(params?.settings || {})),
    sessionCounts: new Map(
      Object.entries(params?.sessionCounts || {}).map(([providerId, count]) => [providerId, Number(count)]),
    ),
    queries: [],
    runCalls: [],
  };
}

describe('provider guards', () => {
  const originalDefaultApiKey = process.env.LUMOS_DEFAULT_API_KEY;

  beforeEach(() => {
    delete process.env.LUMOS_DEFAULT_API_KEY;
  });

  afterAll(() => {
    if (originalDefaultApiKey === undefined) {
      delete process.env.LUMOS_DEFAULT_API_KEY;
    } else {
      process.env.LUMOS_DEFAULT_API_KEY = originalDefaultApiKey;
    }
  });

  test('getDefaultProvider only reads settings.default_provider_id and no longer falls back to is_active', () => {
    const activeProvider = createProvider({ id: 'provider-active', is_active: 1 });
    const state = createState({ providers: [activeProvider] });
    mockDb = createMockDb(state);

    expect(getDefaultProvider()).toBeUndefined();
    expect(state.queries.some((sql) => sql.includes('WHERE is_active = 1 LIMIT 1'))).toBe(false);
  });

  test('activateProvider blocks non agent-chat providers from becoming the default provider', () => {
    const provider = createProvider({
      id: 'provider-text',
      capabilities: '["text-gen"]',
    });
    mockDb = createMockDb(createState({ providers: [provider] }));

    expect(() => activateProvider(provider.id)).toThrow(ProviderActivationBlockedError);
  });

  test('createProvider blocks generic openai-compatible providers without base_url', () => {
    mockDb = createMockDb(createState());

    expect(() => createProviderRecord({
      name: 'Broken OpenAI Compatible',
      provider_type: 'custom',
      api_protocol: 'openai-compatible',
      capabilities: '["text-gen"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      base_url: '',
      api_key: 'sk-test',
    })).toThrow(ProviderValidationError);
  });

  test('updateProvider blocks removing agent-chat from the current default provider', () => {
    const provider = createProvider({ id: 'provider-default' });
    const state = createState({
      providers: [provider],
      settings: {
        default_provider_id: provider.id,
      },
    });
    mockDb = createMockDb(state);

    expect(() => updateProvider(provider.id, {
      capabilities: '["text-gen"]',
    })).toThrow(ProviderUpdateBlockedError);
    expect(state.runCalls.some((call) => call.sql.startsWith('UPDATE api_providers SET name = ?'))).toBe(false);
  });

  test('updateProvider blocks local_auth when the provider is used by the knowledge override', () => {
    const provider = createProvider({
      id: 'provider-knowledge',
      capabilities: '["text-gen"]',
      auth_mode: 'api_key',
    });
    const state = createState({
      providers: [provider],
      settings: {
        'provider_override:knowledge': provider.id,
      },
    });
    mockDb = createMockDb(state);

    expect(() => updateProvider(provider.id, {
      auth_mode: 'local_auth',
    })).toThrow(ProviderUpdateBlockedError);
  });

  test('updateProvider allows openai-compatible text providers for the knowledge override', () => {
    const provider = createProvider({
      id: 'provider-knowledge-protocol',
      capabilities: '["text-gen"]',
      api_protocol: 'anthropic-messages',
    });
    mockDb = createMockDb(createState({
      providers: [provider],
      settings: {
        'provider_override:knowledge': provider.id,
      },
    }));

    expect(() => updateProvider(provider.id, {
      api_protocol: 'openai-compatible',
    })).not.toThrow();
  });

  test('updateProvider blocks removing agent-chat from providers still referenced by chat sessions', () => {
    const provider = createProvider({ id: 'provider-session' });
    mockDb = createMockDb(createState({
      providers: [provider],
      sessionCounts: {
        [provider.id]: 2,
      },
    }));

    expect(() => updateProvider(provider.id, {
      capabilities: '["image-gen"]',
    })).toThrow(ProviderUpdateBlockedError);
  });

  test('updateProvider blocks local_auth when the provider is used by memory intelligence', () => {
    const provider = createProvider({
      id: 'provider-memory',
      capabilities: '["text-gen"]',
    });
    mockDb = createMockDb(createState({
      providers: [provider],
      settings: {
        memory_intelligence_provider_id: provider.id,
      },
    }));

    expect(() => updateProvider(provider.id, {
      auth_mode: 'local_auth',
    })).toThrow(ProviderUpdateBlockedError);
  });

  test('resetBuiltinProvider restores the builtin Claude baseline instead of preserving broken fields', () => {
    process.env.LUMOS_DEFAULT_API_KEY = 'sk-reset';
    const builtin = createProvider({
      id: 'provider-builtin',
      name: 'Broken Builtin',
      provider_type: 'anthropic',
      api_protocol: 'openai-compatible',
      capabilities: '["text-gen"]',
      provider_origin: 'custom',
      auth_mode: 'local_auth',
      is_builtin: 1,
      user_modified: 1,
    });
    const state = createState({
      providers: [builtin],
      settings: {
        default_provider_id: builtin.id,
      },
    });
    mockDb = createMockDb(state);

    const result = resetBuiltinProvider();

    expect(result).toBeDefined();
    expect(state.providers.get(builtin.id)).toEqual(expect.objectContaining({
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      api_key: 'sk-reset',
      user_modified: 0,
    }));
  });
});
