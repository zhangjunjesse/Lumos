// @lumos/app — iframe-side SDK that AI-generated app code imports.
//
//   import { db, nav, ai, workflow, notify, storage } from '@lumos/app';
//
// At build time this file is bundled into resources/app-runtime/app.mjs and
// served by the lumos-app:// protocol handler. The bundle exports the same
// public surface as this source file. Inside the bundle, all RPC calls go
// through window.parent.postMessage to the host.

import type {
  RpcMethod, RpcResponse, RpcStreamEvent, SandboxEvent,
  HandshakeResponse, RpcError,
} from '@/lib/app/sandbox/protocol';

// ---- public types --------------------------------------------------------

export type Filter = Record<string, unknown>;

export interface ListOptions {
  filter?: Filter;
  /** Field name; prefix `-` for desc. */
  sort?: string;
  limit?: number;
  offset?: number;
  /** Subset of fields to fetch. */
  select?: string[];
}

export type CollectionRow<T = Record<string, unknown>> = T & { id: string };

export interface DbCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  list(opts?: ListOptions): Promise<CollectionRow<T>[]>;
  get(id: string): Promise<CollectionRow<T> | null>;
  count(filter?: Filter): Promise<number>;
  create(data: Omit<T, 'id'>): Promise<CollectionRow<T>>;
  update(id: string, patch: Partial<T>): Promise<CollectionRow<T> | null>;
  delete(id: string): Promise<boolean>;
  watch(opts: ListOptions | undefined, callback: (rows: CollectionRow<T>[]) => void): () => void;
}

export interface NavApi {
  push(routeId: string, params?: Record<string, string>): void;
  replace(routeId: string, params?: Record<string, string>): void;
  back(): void;
  params(): Record<string, string>;
  current(): string;
  subscribe(callback: (route: { id: string; params: Record<string, string> }) => void): () => void;
}

export interface AiCompleteOptions {
  /** Optional model id. When omitted, Lumos uses the current global text model. */
  model?: string;
  /** Reserved for future per-app provider override. Current runtime uses Lumos global provider. */
  providerId?: string;
  maxTokens?: number;
  system?: string;
  temperature?: number;
}

export interface AiApi {
  complete(prompt: string, opts?: AiCompleteOptions): Promise<string>;
  stream(prompt: string, opts?: AiCompleteOptions): AsyncIterable<string>;
  structured<T>(prompt: string, schema: unknown, opts?: AiCompleteOptions): Promise<T>;
}

export interface WorkflowApi {
  run<I = unknown, O = unknown>(workflowId: string, input: I): Promise<{ status: 'ok' | 'failed'; output?: O; error?: string }>;
  runStream<I = unknown, E = unknown>(workflowId: string, input: I): AsyncIterable<E>;
}

export interface DeepSearchStartOptions {
  sites?: string[];
  goal?: 'browse' | 'evidence' | 'full-content' | 'research-report';
  pageMode?: 'takeover_active_page' | 'managed_page';
  strictness?: 'strict' | 'best_effort';
  maxPages?: number;
  maxDepth?: number;
  keepEvidence?: boolean;
  keepScreenshots?: boolean;
}

export interface DeepSearchApi {
  start(query: string, opts?: DeepSearchStartOptions): Promise<unknown>;
  getResult(runId: string): Promise<unknown>;
  pause(runId: string): Promise<unknown>;
  resume(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
}

export interface ImNotifyOptions {
  notificationId?: string;
  title?: string;
  text?: string;
  message?: string;
  reason?: string;
  target_label?: string;
}

export interface ImApi {
  notify(opts: ImNotifyOptions): Promise<unknown>;
}

export interface NotifyApi {
  toast(opts: { title: string; description?: string; level?: 'info' | 'success' | 'warning' | 'error' }): void;
  confirm(message: string, opts?: { title?: string; destructive?: boolean }): Promise<boolean>;
  dialog<T>(component: 'select' | 'prompt', props: Record<string, unknown>): Promise<T | null>;
}

export interface StorageScope {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface StorageApi {
  local: StorageScope;
}

export interface SecretsApi {
  get(key: string): Promise<string | null>;
}

export interface ConfigApi {
  get<T = string>(key: string): Promise<T | null>;
  all(): Promise<Record<string, string>>;
}

export interface FilesApi {
  pick(opts?: { accept?: string; multiple?: boolean }): Promise<File[]>;
  save(filename: string, blob: Blob): Promise<string>;
  readAsText(file: File): Promise<string>;
}

export class LumosError extends Error {
  code: RpcError['code'];
  hint?: string;
  constructor(error: RpcError) {
    super(error.message);
    this.name = 'LumosError';
    this.code = error.code;
    this.hint = error.hint;
  }
}

// ---- implementation ------------------------------------------------------

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** for streams */
  push?: (chunk: unknown) => void;
  end?: (error?: RpcError) => void;
}

let bridge: Bridge | null = null;

class Bridge {
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private routeListeners = new Set<(r: { id: string; params: Record<string, string> }) => void>();
  private themeListeners = new Set<(mode: 'light' | 'dark') => void>();
  private currentRoute = { id: '', params: {} as Record<string, string> };
  private theme: 'light' | 'dark' = 'light';
  private handshake: HandshakeResponse | null = null;
  private targetOrigin = '*';

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('message', (event) => this.onMessage(event.data));
  }

  isReady(): boolean { return !!this.handshake; }
  getRoute() { return this.currentRoute; }
  getTheme() { return this.theme; }
  getManifest(): unknown { return this.handshake?.manifest; }

  async ready(): Promise<HandshakeResponse> {
    if (this.handshake) return this.handshake;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.handshake) return resolve(this.handshake);
        if (Date.now() - start > 5000) return reject(new Error('handshake timeout'));
        setTimeout(tick, 30);
      };
      tick();
    });
  }

  send(method: RpcMethod, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `rpc-${this.nextId++}`;
      this.pending.set(id, { resolve, reject });
      this.post({ id, type: 'rpc', method, params });
    });
  }

  /** Start a streaming RPC. Returns a tuple [iterable, cancel]. */
  startStream(method: RpcMethod, params: unknown): [AsyncIterable<unknown>, () => void] {
    const id = `stream-${this.nextId++}`;
    const buffer: unknown[] = [];
    let waiter: ((next: IteratorResult<unknown>) => void) | null = null;
    let ended = false;
    let endError: RpcError | null = null;

    const push = (chunk: unknown) => {
      if (waiter) { waiter({ value: chunk, done: false }); waiter = null; return; }
      buffer.push(chunk);
    };
    const end = (err?: RpcError) => {
      ended = true;
      if (err) endError = err;
      if (waiter) { waiter({ value: undefined, done: true }); waiter = null; }
    };
    this.pending.set(id, {
      resolve: () => { /* unused for streams */ },
      reject: (err) => end({ code: 'INTERNAL', message: err.message }),
      push,
      end,
    });

    this.post({ id, type: 'rpc', method, params });

    const iterable: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<unknown>>((resolve) => {
          if (buffer.length > 0) return resolve({ value: buffer.shift(), done: false });
          if (ended) {
            if (endError) return resolve(Promise.reject(new LumosError(endError)) as unknown as IteratorResult<unknown>);
            return resolve({ value: undefined, done: true });
          }
          waiter = resolve;
        }),
      }),
    };
    const cancel = () => {
      this.post({ id, type: 'rpc-cancel' });
      end();
      this.pending.delete(id);
    };
    return [iterable, cancel];
  }

  onRoute(callback: (r: { id: string; params: Record<string, string> }) => void): () => void {
    this.routeListeners.add(callback);
    return () => this.routeListeners.delete(callback);
  }
  onTheme(callback: (mode: 'light' | 'dark') => void): () => void {
    this.themeListeners.add(callback);
    return () => this.themeListeners.delete(callback);
  }

  private post(msg: unknown) {
    if (typeof window === 'undefined') return;
    window.parent.postMessage(msg, this.targetOrigin);
  }

  private onMessage(msg: unknown) {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { type?: string };
    if (m.type === 'app.handshake.response') {
      this.handshake = (msg as { payload: HandshakeResponse }).payload;
      this.currentRoute = this.handshake.initialRoute;
      this.theme = this.handshake.theme;
      return;
    }
    if (m.type === 'rpc-response') {
      const r = msg as RpcResponse;
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if ('error' in r) p.reject(new LumosError(r.error));
      else p.resolve(r.result);
      return;
    }
    if (m.type === 'rpc-stream') {
      const e = msg as RpcStreamEvent;
      const p = this.pending.get(e.id);
      if (!p) return;
      if (e.kind === 'data' && p.push) p.push(e.data);
      else if (e.kind === 'end' && p.end) { p.end(); this.pending.delete(e.id); }
      else if (e.kind === 'error' && p.end) { p.end(e.error); this.pending.delete(e.id); }
      return;
    }
    if (m.type === 'route') {
      const r = msg as Extract<SandboxEvent, { type: 'route' }>;
      this.currentRoute = { id: r.route, params: r.params };
      for (const cb of this.routeListeners) cb(this.currentRoute);
      return;
    }
    if (m.type === 'theme') {
      const t = msg as Extract<SandboxEvent, { type: 'theme' }>;
      this.theme = t.mode;
      for (const cb of this.themeListeners) cb(t.mode);
      return;
    }
  }
}

function getBridge(): Bridge {
  if (!bridge) bridge = new Bridge();
  return bridge;
}

// ---- public api ---------------------------------------------------------

export const db = {
  collection<T extends Record<string, unknown>>(name: string): DbCollection<T> {
    const b = getBridge();
    return {
      list: (opts) => b.send('db.list', { collection: name, opts }) as Promise<CollectionRow<T>[]>,
      get: (id) => b.send('db.get', { collection: name, id }) as Promise<CollectionRow<T> | null>,
      count: (filter) => b.send('db.count', { collection: name, filter }) as Promise<number>,
      create: (data) => b.send('db.create', { collection: name, data }) as Promise<CollectionRow<T>>,
      update: (id, patch) => b.send('db.update', { collection: name, id, patch }) as Promise<CollectionRow<T> | null>,
      delete: (id) => b.send('db.delete', { collection: name, id }) as Promise<boolean>,
      watch: (opts, callback) => {
        const [iter, cancel] = b.startStream('db.watch.start', { collection: name, opts });
        (async () => {
          for await (const rows of iter) callback(rows as CollectionRow<T>[]);
        })().catch(() => { /* swallow; cancel will end */ });
        return cancel;
      },
    };
  },
};

export const nav: NavApi = {
  push: (id, params = {}) => { void getBridge().send('nav.push' as RpcMethod, { id, params }); },
  replace: (id, params = {}) => { void getBridge().send('nav.replace' as RpcMethod, { id, params }); },
  back: () => { void getBridge().send('nav.back' as RpcMethod, {}); },
  params: () => getBridge().getRoute().params,
  current: () => getBridge().getRoute().id,
  subscribe: (cb) => getBridge().onRoute(cb),
};

export const ai: AiApi = {
  complete: (prompt, opts) => getBridge().send('ai.complete', { prompt, opts }) as Promise<string>,
  stream: (prompt, opts) => {
    const [iter] = getBridge().startStream('ai.stream.start', { prompt, opts });
    return iter as AsyncIterable<string>;
  },
  structured: (prompt, schema, opts) => getBridge().send('ai.structured', { prompt, schema, opts }) as Promise<never>,
};

export const workflow: WorkflowApi = {
  run: (id, input) => getBridge().send('workflow.run', { id, input }) as Promise<{ status: 'ok' | 'failed'; output?: never; error?: string }>,
  runStream: (id, input) => {
    const [iter] = getBridge().startStream('workflow.run.stream.start', { id, input });
    return iter as AsyncIterable<never>;
  },
};

export const deepsearch: DeepSearchApi = {
  start: (query, opts = {}) => getBridge().send('deepsearch.start', { query, ...opts }),
  getResult: (runId) => getBridge().send('deepsearch.getResult', { runId }),
  pause: (runId) => getBridge().send('deepsearch.pause', { runId }),
  resume: (runId) => getBridge().send('deepsearch.resume', { runId }),
  cancel: (runId) => getBridge().send('deepsearch.cancel', { runId }),
};

export const im: ImApi = {
  notify: (opts) => getBridge().send('im.notify', opts ?? {}),
};

export const notify: NotifyApi = {
  toast: (opts) => { void getBridge().send('notify.toast', opts); },
  confirm: (message, opts) => getBridge().send('notify.confirm', { message, ...opts }) as Promise<boolean>,
  dialog: (component, props) => getBridge().send('notify.dialog', { component, props }) as Promise<never>,
};

export const storage: StorageApi = {
  local: {
    get: (key) => getBridge().send('storage.get', { scope: 'local', key }) as Promise<never>,
    set: (key, value) => getBridge().send('storage.set', { scope: 'local', key, value }) as Promise<void>,
    remove: (key) => getBridge().send('storage.remove', { scope: 'local', key }) as Promise<void>,
    clear: () => getBridge().send('storage.clear', { scope: 'local' }) as Promise<void>,
  },
};

export const secrets: SecretsApi = {
  get: (key) => getBridge().send('secrets.get', { key }) as Promise<string | null>,
};

export const config: ConfigApi = {
  get: (key) => getBridge().send('config.get', { key }) as Promise<never>,
  all: () => getBridge().send('config.all', {}) as Promise<Record<string, string>>,
};

export const files: FilesApi = {
  pick: (opts) => getBridge().send('files.pick', opts ?? {}) as Promise<File[]>,
  save: (filename, blob) => getBridge().send('files.save', { filename, blob }) as Promise<string>,
  readAsText: (file) => getBridge().send('files.read', { file, as: 'text' }) as Promise<string>,
};

/** Wait until handshake completes. Optional — most APIs will queue until ready. */
export async function ready(): Promise<HandshakeResponse> {
  return getBridge().ready();
}
