import {
  DEEP_RESEARCH_ADVANCE_TASKS_ID,
  DEEP_RESEARCH_TOPUP_EVIDENCE_ID,
  ensureDeepResearchDefaultAutomations,
} from '../deep-research-default-automations';
import type { AppDataStore, AppRow, QueryOptions } from '../runtime/data-store';

describe('deep-research default automations', () => {
  it('seeds the two SOP-supporting automation rows disabled by default', () => {
    const store = createMemoryStore();

    ensureDeepResearchDefaultAutomations(store);

    const rows = store.query('app_automations');
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: DEEP_RESEARCH_ADVANCE_TASKS_ID,
          native_action: 'deep-research:advance-active-tasks',
          enabled: false,
          schedule_status: 'not_connected',
        }),
        expect.objectContaining({
          id: DEEP_RESEARCH_TOPUP_EVIDENCE_ID,
          native_action: 'deep-research:topup-evidence',
          enabled: false,
          schedule_status: 'not_connected',
        }),
      ]),
    );
  });

  it('is idempotent: re-seeding does not duplicate rows or clobber user edits', () => {
    const store = createMemoryStore();
    ensureDeepResearchDefaultAutomations(store);

    // Simulate a user enabling and re-scheduling the advance task.
    const seeded = store
      .query<{ native_action?: string; id: string }>('app_automations')
      .find((r) => r.native_action === 'deep-research:advance-active-tasks');
    expect(seeded).toBeDefined();
    store.update('app_automations', seeded!.id, {
      enabled: true,
      schedule: '每 30 分钟',
      schedule_status: 'scheduled',
    });

    ensureDeepResearchDefaultAutomations(store);

    const rows = store.query<{
      id: string;
      enabled?: boolean;
      schedule?: string;
      schedule_status?: string;
    }>('app_automations');
    expect(rows).toHaveLength(2);
    const advance = rows.find((r) => r.id === seeded!.id);
    expect(advance).toEqual(
      expect.objectContaining({
        enabled: true,
        schedule: '每 30 分钟',
        schedule_status: 'scheduled',
      }),
    );
  });
});

function createMemoryStore(): AppDataStore {
  const collections = new Map<string, Map<string, AppRow>>();
  let counter = 0;
  const collection = (name: string) => {
    let rows = collections.get(name);
    if (!rows) {
      rows = new Map();
      collections.set(name, rows);
    }
    return rows;
  };
  return {
    query<T = Record<string, unknown>>(name: string, opts: QueryOptions = {}): AppRow<T>[] {
      let rows = Array.from(collection(name).values()) as AppRow<T>[];
      if (opts.limit !== undefined)
        rows = rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
      return rows;
    },
    get<T = Record<string, unknown>>(name: string, id: string): AppRow<T> | null {
      return (collection(name).get(id) as AppRow<T> | undefined) ?? null;
    },
    create<T extends Record<string, unknown>>(
      name: string,
      data: T & { id?: string },
    ): AppRow<T> {
      const id = data.id ?? `row-${++counter}`;
      const { id: _ignored, ...rest } = data;
      void _ignored;
      const row = { ...rest, id } as AppRow<T>;
      collection(name).set(id, row);
      return row;
    },
    update<T extends Record<string, unknown>>(
      name: string,
      id: string,
      patch: Partial<T>,
    ): AppRow<T> | null {
      const existing = collection(name).get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, id } as AppRow<T>;
      collection(name).set(id, next);
      return next;
    },
    delete(name: string, id: string): boolean {
      return collection(name).delete(id);
    },
    count(name: string): number {
      return collection(name).size;
    },
  };
}
