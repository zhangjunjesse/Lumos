// Mock @/lib/db before importing the module under test
const store = new Map<string, string>();
jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => store.get(key),
  setSetting: (key: string, value: string) => {
    store.set(key, value);
  },
}));

import {
  getProviderField,
  setProviderField,
  getProviderConfig,
  setProviderConfig,
  isProviderConfigured,
  getEnabledProviders,
  setProviderEnabled,
  isProviderEnabled,
  getDefaultProviderId,
  setDefaultProviderId,
  isMigrationApplied,
  markMigrationApplied,
} from '../config-store';
import { registerPlugin, __resetRegistryForTesting } from '../registry';
import type { IMPlugin, IMAdapter } from '../types';

const fakePlugin: IMPlugin = {
  manifest: {
    id: 'fake',
    label: 'Fake',
    description: 'test plugin',
    configSchema: [
      { key: 'host', label: 'Host', type: 'url', required: true, default: 'http://localhost' },
      { key: 'token', label: 'Token', type: 'secret', required: true },
      { key: 'name', label: 'Name', type: 'string', required: false },
    ],
    capabilities: {
      chatTypes: ['direct'],
      media: false,
      reactions: false,
      threads: false,
      edit: false,
      commands: false,
      targetDirectory: false,
      streamingPreview: false,
    },
  },
  createAdapter: () => ({} as IMAdapter),
};

beforeEach(() => {
  store.clear();
  __resetRegistryForTesting();
  registerPlugin(fakePlugin);
});

describe('im/core/config-store: per-field', () => {
  test('reads and writes single field via namespaced key', () => {
    setProviderField('fake', 'host', 'https://example.com');
    expect(getProviderField('fake', 'host')).toBe('https://example.com');
    // The underlying key is im.<id>.<field>
    expect(store.get('im.fake.host')).toBe('https://example.com');
  });

  test('returns empty string for missing field', () => {
    expect(getProviderField('fake', 'host')).toBe('');
  });
});

describe('im/core/config-store: whole-config read/write', () => {
  test('getProviderConfig falls back to defaults from manifest', () => {
    expect(getProviderConfig('fake')).toEqual({ host: 'http://localhost' });
  });

  test('getProviderConfig merges stored values over defaults', () => {
    setProviderField('fake', 'host', 'https://prod.example');
    setProviderField('fake', 'token', 'tk-123');
    expect(getProviderConfig('fake')).toEqual({
      host: 'https://prod.example',
      token: 'tk-123',
    });
  });

  test('setProviderConfig ignores unknown keys', () => {
    setProviderConfig('fake', { host: 'https://x', bogus: 'evil' });
    expect(store.has('im.fake.bogus')).toBe(false);
    expect(store.get('im.fake.host')).toBe('https://x');
  });

  test('setProviderConfig preserves secret when value is masked', () => {
    setProviderField('fake', 'token', 'real-secret');
    setProviderConfig(
      'fake',
      { token: '***real-secret' },
      { allowSecretMaskPassthrough: true },
    );
    expect(getProviderField('fake', 'token')).toBe('real-secret');
  });

  test('setProviderConfig overwrites secret when not in mask passthrough mode', () => {
    setProviderField('fake', 'token', 'real-secret');
    setProviderConfig('fake', { token: '***real-secret' });
    expect(getProviderField('fake', 'token')).toBe('***real-secret');
  });

  test('setProviderConfig throws for unknown provider', () => {
    expect(() => setProviderConfig('ghost', { x: 'y' })).toThrow(/unknown provider/);
  });

  test('isProviderConfigured returns false until all required fields set', () => {
    expect(isProviderConfigured('fake')).toBe(false); // host has default but token missing
    setProviderField('fake', 'token', 'tk');
    expect(isProviderConfigured('fake')).toBe(true);
  });
});

describe('im/core/config-store: enabled list', () => {
  test('starts empty', () => {
    expect(getEnabledProviders()).toEqual([]);
  });

  test('setProviderEnabled adds and removes idempotently', () => {
    setProviderEnabled('fake', true);
    setProviderEnabled('fake', true); // idempotent
    expect(getEnabledProviders()).toEqual(['fake']);
    expect(isProviderEnabled('fake')).toBe(true);

    setProviderEnabled('fake', false);
    expect(isProviderEnabled('fake')).toBe(false);
  });

  test('survives malformed JSON in storage', () => {
    store.set('im.enabled', 'not-json');
    expect(getEnabledProviders()).toEqual([]);
  });
});

describe('im/core/config-store: default provider', () => {
  test('null when unset', () => {
    expect(getDefaultProviderId()).toBeNull();
  });

  test('roundtrip', () => {
    setDefaultProviderId('fake');
    expect(getDefaultProviderId()).toBe('fake');
    setDefaultProviderId(null);
    expect(getDefaultProviderId()).toBeNull();
  });
});

describe('im/core/config-store: migration tracking', () => {
  test('starts unapplied', () => {
    expect(isMigrationApplied('feishu-2026-04')).toBe(false);
  });

  test('markMigrationApplied flips and persists', () => {
    markMigrationApplied('feishu-2026-04');
    expect(isMigrationApplied('feishu-2026-04')).toBe(true);
    expect(store.get('im.migration.feishu-2026-04')).toBe('1');
  });
});
