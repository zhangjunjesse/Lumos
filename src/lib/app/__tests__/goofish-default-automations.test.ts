import {
  ensureGoofishDefaultAutomations,
  ensureGoofishReminderAutomation,
  GOOFISH_REMINDER_AUTOMATION_ACTION,
  GOOFISH_REMINDER_AUTOMATION_ID,
  GOOFISH_REMINDER_AUTOMATION_SCHEDULE,
} from '../goofish-default-automations';
import type { AppDataStore, AppRow, QueryOptions } from '../runtime/data-store';

describe('goofish default automations', () => {
  it('seeds deterministic built-in automation rows', () => {
    const store = createMemoryStore();

    ensureGoofishDefaultAutomations(store);

    const rows = store.query('app_automations');
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: GOOFISH_REMINDER_AUTOMATION_ID,
        native_action: GOOFISH_REMINDER_AUTOMATION_ACTION,
        schedule: GOOFISH_REMINDER_AUTOMATION_SCHEDULE,
        enabled: false,
        schedule_status: 'not_connected',
      }),
    ]));
    expect(rows).toHaveLength(3);
  });

  it('does not overwrite user schedule or enabled state for an existing reminder automation', () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'custom-reminder',
      title: '我的提醒扫描',
      enabled: true,
      schedule: '每 15 分钟',
      native_action: GOOFISH_REMINDER_AUTOMATION_ACTION,
      schedule_status: 'scheduled',
    });

    const row = ensureGoofishReminderAutomation(store);

    expect(row).toEqual(expect.objectContaining({
      id: 'custom-reminder',
      title: '我的提醒扫描',
      enabled: true,
      schedule: '每 15 分钟',
      schedule_status: 'scheduled',
    }));
    expect(store.query('app_automations')).toHaveLength(1);
  });

  it('can explicitly enable the reminder automation while preserving the schedule', () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: GOOFISH_REMINDER_AUTOMATION_ID,
      enabled: false,
      schedule: '每 15 分钟',
      native_action: GOOFISH_REMINDER_AUTOMATION_ACTION,
    });

    const row = ensureGoofishReminderAutomation(store, { enabled: true });

    expect(row).toEqual(expect.objectContaining({
      id: GOOFISH_REMINDER_AUTOMATION_ID,
      enabled: true,
      schedule: '每 15 分钟',
    }));
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
      if (opts.limit !== undefined) rows = rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
      return rows;
    },
    get<T = Record<string, unknown>>(name: string, id: string): AppRow<T> | null {
      return (collection(name).get(id) as AppRow<T> | undefined) ?? null;
    },
    create<T extends Record<string, unknown>>(name: string, data: T & { id?: string }): AppRow<T> {
      const id = data.id ?? `row-${++counter}`;
      const { id: _ignored, ...rest } = data;
      void _ignored;
      const row = { ...rest, id } as AppRow<T>;
      collection(name).set(id, row);
      return row;
    },
    update<T extends Record<string, unknown>>(name: string, id: string, patch: Partial<T>): AppRow<T> | null {
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
