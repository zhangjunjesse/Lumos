import { dispatchRpc, type DispatcherAdapters, type DispatcherContext } from '../dispatcher';
import type { ManifestV2 } from '@/lib/app/compile/types';
import type { RpcRequest } from '../protocol';

function makeManifest(perm: Partial<ManifestV2['permissions']> = {}): ManifestV2 {
  return {
    id: 'test-app',
    name: '测试应用',
    version: '0.1.0',
    entry: 'home',
    routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
    permissions: perm as ManifestV2['permissions'],
    runtime: { engine: 'react-v2', react: '19' },
  };
}

function fakeDb(): DispatcherAdapters['db'] {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    list: async (col, _opts) => {
      void col; void _opts;
      return Array.from(rows.values());
    },
    get: async (col, id) => { void col; return rows.get(id) ?? null; },
    count: async (col, _filter) => { void col; void _filter; return rows.size; },
    create: async (col, data) => {
      const id = `row-${rows.size + 1}`;
      const row = { id, ...(data as Record<string, unknown>) };
      rows.set(id, row);
      void col;
      return row;
    },
    update: async (col, id, patch) => {
      const cur = rows.get(id);
      if (!cur) return null;
      const next = { ...cur, ...(patch as Record<string, unknown>) };
      rows.set(id, next);
      void col;
      return next;
    },
    delete: async (col, id) => { void col; return rows.delete(id); },
  };
}

function ctx(perm: Partial<ManifestV2['permissions']> = {}, adapters?: Partial<DispatcherAdapters>): DispatcherContext {
  return {
    appId: 'test-app',
    manifest: makeManifest(perm),
    adapters: { db: fakeDb(), ...adapters } as DispatcherAdapters,
  };
}

function req(method: string, params: unknown, id = 'r1'): RpcRequest {
  return { id, type: 'rpc', method: method as never, params };
}

describe('host RPC dispatcher', () => {
  test('handshake works without permissions', async () => {
    const r = await dispatchRpc(req('app.handshake', {}), ctx({}));
    expect('result' in r).toBe(true);
  });

  test('db.list requires read permission', async () => {
    const denied = await dispatchRpc(req('db.list', { collection: 'tasks' }), ctx({ db: { read: [] } }));
    expect('error' in denied && denied.error?.code).toBe('PERM_DENIED');

    const allowed = await dispatchRpc(req('db.list', { collection: 'tasks' }), ctx({ db: { read: ['tasks'] } }));
    expect('result' in allowed).toBe(true);
  });

  test('db.create requires write permission', async () => {
    const denied = await dispatchRpc(req('db.create', { collection: 'tasks', data: { title: 'x' } }), ctx({ db: { read: ['tasks'] } }));
    expect('error' in denied && denied.error?.code).toBe('PERM_DENIED');

    const c = ctx({ db: { read: ['tasks'], write: ['tasks'] } });
    const r1 = await dispatchRpc(req('db.create', { collection: 'tasks', data: { title: 'x' } }), c);
    expect('result' in r1).toBe(true);
    if ('result' in r1) expect((r1.result as { id: string }).id).toBe('row-1');
  });

  test('full crud cycle', async () => {
    const c = ctx({ db: { read: ['todos'], write: ['todos'] } });
    const created = await dispatchRpc(req('db.create', { collection: 'todos', data: { title: 'a', done: false } }, 'a'), c);
    if (!('result' in created)) throw new Error('create failed');
    const id = (created.result as { id: string }).id;

    const updated = await dispatchRpc(req('db.update', { collection: 'todos', id, patch: { done: true } }, 'b'), c);
    expect('result' in updated && (updated.result as { done: boolean }).done).toBe(true);

    const got = await dispatchRpc(req('db.get', { collection: 'todos', id }, 'c'), c);
    expect('result' in got && (got.result as { id: string }).id).toBe(id);

    const count = await dispatchRpc(req('db.count', { collection: 'todos' }, 'd'), c);
    expect('result' in count && count.result).toBe(1);

    const del = await dispatchRpc(req('db.delete', { collection: 'todos', id }, 'e'), c);
    expect('result' in del && del.result).toBe(true);
  });

  test('validation error for missing collection param', async () => {
    const r = await dispatchRpc(req('db.list', {}), ctx({ db: { read: [] } }));
    expect('error' in r && r.error?.code).toBe('VALIDATION');
  });

  test('ai.complete requires permission and adapter', async () => {
    const noPerm = await dispatchRpc(req('ai.complete', { prompt: 'hi' }), ctx({}));
    expect('error' in noPerm && noPerm.error?.code).toBe('PERM_DENIED');

    const noAdapter = await dispatchRpc(req('ai.complete', { prompt: 'hi' }), ctx({ ai: { complete: true } }));
    expect('error' in noAdapter && noAdapter.error?.code).toBe('UNSUPPORTED');

    const ai = { complete: async (p: string) => `echo:${p}` };
    const ok = await dispatchRpc(req('ai.complete', { prompt: 'hi' }), ctx({ ai: { complete: true } }, { ai }));
    expect('result' in ok && ok.result).toBe('echo:hi');
  });

  test('workflow.run requires permission for that specific workflow id', async () => {
    const c = ctx({ workflow: { run: ['weekly-report'] } }, {
      workflow: { run: async (id) => ({ status: 'ok', output: { ran: id } }) },
    });
    const denied = await dispatchRpc(req('workflow.run', { id: 'other' }), c);
    expect('error' in denied && denied.error?.code).toBe('PERM_DENIED');

    const allowed = await dispatchRpc(req('workflow.run', { id: 'weekly-report', input: {} }), c);
    expect('result' in allowed).toBe(true);
  });

  test('deepsearch.start requires permission and adapter', async () => {
    const noPerm = await dispatchRpc(req('deepsearch.start', { query: '量子计算' }), ctx({}));
    expect('error' in noPerm && noPerm.error?.code).toBe('PERM_DENIED');

    const noAdapter = await dispatchRpc(
      req('deepsearch.start', { query: '量子计算' }),
      ctx({ deepsearch: { start: true } }),
    );
    expect('error' in noAdapter && noAdapter.error?.code).toBe('UNSUPPORTED');

    const ok = await dispatchRpc(
      req('deepsearch.start', { query: '量子计算', sites: ['project_gutenberg'], strictness: 'best_effort' }),
      ctx(
        { deepsearch: { start: true } },
        { deepsearch: {
          start: async (input) => ({ runId: 'run-1', input }),
          getResult: async () => ({}),
          pause: async () => ({}),
          resume: async () => ({}),
          cancel: async () => ({}),
        } },
      ),
    );
    expect('result' in ok && (ok.result as { runId: string }).runId).toBe('run-1');
  });

  test('deepsearch.getResult requires read permission', async () => {
    const adapters = {
      deepsearch: {
        start: async () => ({}),
        getResult: async (runId: string) => ({ runId, status: 'completed' }),
        pause: async () => ({}),
        resume: async () => ({}),
        cancel: async () => ({}),
      },
    };
    const denied = await dispatchRpc(req('deepsearch.getResult', { runId: 'run-1' }), ctx({ deepsearch: { start: true } }, adapters));
    expect('error' in denied && denied.error?.code).toBe('PERM_DENIED');

    const ok = await dispatchRpc(req('deepsearch.getResult', { runId: 'run-1' }), ctx({ deepsearch: { read: true } }, adapters));
    expect('result' in ok && (ok.result as { runId: string }).runId).toBe('run-1');
  });

  test('secrets.get scoped per key', async () => {
    const c = ctx(
      { secrets: ['OPENAI_KEY'] },
      { secrets: { get: async (k) => (k === 'OPENAI_KEY' ? 'sk-test' : null) } },
    );
    const denied = await dispatchRpc(req('secrets.get', { key: 'AWS_KEY' }), c);
    expect('error' in denied && denied.error?.code).toBe('PERM_DENIED');
    const ok = await dispatchRpc(req('secrets.get', { key: 'OPENAI_KEY' }), c);
    expect('result' in ok && ok.result).toBe('sk-test');
  });

  test('streaming methods rejected by sync dispatcher with hint', async () => {
    const r = await dispatchRpc(req('db.watch.start', { collection: 'x' }), ctx({ db: { read: ['x'] } }));
    expect('error' in r && r.error?.code).toBe('UNSUPPORTED');
  });

  test('unknown method returns UNSUPPORTED', async () => {
    const r = await dispatchRpc(req('something.weird', {}), ctx({}));
    expect('error' in r && r.error?.code).toBe('UNSUPPORTED');
  });
});
