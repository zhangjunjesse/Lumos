/**
 * Guards the login-time default_provider_id seeding logic.
 *
 * Regression: cloud login used to unconditionally overwrite
 * `default_provider_id`, silently resetting users' customized chat provider
 * on every session. ensureDefaultProviderFallback must only seed when the
 * setting is missing or points to a deleted provider.
 */

import { ensureDefaultProviderFallback } from '../lumos-cloud-auth';

type MockRow = { value?: string } | undefined;

interface MockState {
  defaultId: string | null;
  existingProviderIds: Set<string>;
  runs: Array<{ sql: string; args: unknown[] }>;
}

function makeDb(state: MockState) {
  return {
    prepare: (sql: string) => ({
      get: (...args: unknown[]): MockRow | { 1: number } => {
        if (sql.includes("SELECT value FROM settings WHERE key = 'default_provider_id'")) {
          return state.defaultId ? { value: state.defaultId } : undefined;
        }
        if (sql.includes('SELECT 1 FROM api_providers WHERE id = ?')) {
          const id = String(args[0]);
          return state.existingProviderIds.has(id) ? { 1: 1 } : undefined;
        }
        return undefined;
      },
      run: (...args: unknown[]) => {
        state.runs.push({ sql, args });
        if (sql.startsWith('INSERT INTO settings')) {
          state.defaultId = String(args[0]);
        }
        return { changes: 1 };
      },
    }),
  };
}

function createState(overrides: Partial<MockState> = {}): MockState {
  return {
    defaultId: null,
    existingProviderIds: new Set(),
    runs: [],
    ...overrides,
  };
}

describe('ensureDefaultProviderFallback', () => {
  test('seeds Cloud as default when no default is set (first login)', () => {
    const state = createState();
    ensureDefaultProviderFallback(makeDb(state), 'cloud-id');

    expect(state.defaultId).toBe('cloud-id');
    expect(state.runs.some(r => r.sql.startsWith('INSERT INTO settings'))).toBe(true);
  });

  test('preserves user-selected default when it points to a valid provider', () => {
    const state = createState({
      defaultId: 'user-provider',
      existingProviderIds: new Set(['user-provider', 'cloud-id']),
    });
    ensureDefaultProviderFallback(makeDb(state), 'cloud-id');

    expect(state.defaultId).toBe('user-provider');
    expect(state.runs.some(r => r.sql.startsWith('INSERT INTO settings'))).toBe(false);
  });

  test('preserves an existing Cloud default without redundant writes', () => {
    const state = createState({
      defaultId: 'cloud-id',
      existingProviderIds: new Set(['cloud-id']),
    });
    ensureDefaultProviderFallback(makeDb(state), 'cloud-id');

    expect(state.runs.some(r => r.sql.startsWith('INSERT INTO settings'))).toBe(false);
  });

  test('re-seeds Cloud when default points to a deleted provider', () => {
    const state = createState({
      defaultId: 'stale-id',
      existingProviderIds: new Set(['cloud-id']),
    });
    ensureDefaultProviderFallback(makeDb(state), 'cloud-id');

    expect(state.defaultId).toBe('cloud-id');
  });

  test('treats whitespace-only default as empty and seeds Cloud', () => {
    const state = createState({
      defaultId: '   ',
      existingProviderIds: new Set(['cloud-id']),
    });
    ensureDefaultProviderFallback(makeDb(state), 'cloud-id');

    expect(state.defaultId).toBe('cloud-id');
  });
});
