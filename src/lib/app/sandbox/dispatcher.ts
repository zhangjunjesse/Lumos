// Host-side RPC dispatcher. Pure-ish: takes (request + ctx) → response.
// No I/O directly here — host calls this with adapters injected via ctx.

import type {
  RpcRequest, RpcResponse, RpcError, ErrorCode,
} from './protocol';
import type { ManifestV2 } from '@/lib/app/compile/types';
import {
  checkDbRead, checkDbWrite, checkAi, checkWorkflow, checkDeepSearch, checkSecret, checkFiles,
} from './permissions';

// ---- Adapter interface (host wires this up) ------------------------------

export interface DispatcherAdapters {
  db: {
    list(collection: string, opts: unknown): Promise<unknown[]>;
    get(collection: string, id: string): Promise<unknown | null>;
    count(collection: string, filter: unknown): Promise<number>;
    create(collection: string, data: unknown): Promise<unknown>;
    update(collection: string, id: string, patch: unknown): Promise<unknown | null>;
    delete(collection: string, id: string): Promise<boolean>;
  };
  ai?: {
    complete(prompt: string, opts: unknown): Promise<string>;
  };
  workflow?: {
    run(id: string, input: unknown): Promise<{ status: 'ok' | 'failed'; output?: unknown; error?: string }>;
  };
  deepsearch?: {
    start(input: {
      query: string;
      sites?: string[];
      goal?: 'browse' | 'evidence' | 'full-content' | 'research-report';
      pageMode?: 'takeover_active_page' | 'managed_page';
      strictness?: 'strict' | 'best_effort';
      maxPages?: number;
      maxDepth?: number;
      keepEvidence?: boolean;
      keepScreenshots?: boolean;
    }): Promise<unknown>;
    getResult(runId: string): Promise<unknown>;
    pause(runId: string): Promise<unknown>;
    resume(runId: string): Promise<unknown>;
    cancel(runId: string): Promise<unknown>;
  };
  notify?: {
    toast(opts: unknown): void;
    confirm(message: string, opts: unknown): Promise<boolean>;
  };
  storage?: {
    get(scope: string, key: string): Promise<unknown | null>;
    set(scope: string, key: string, value: unknown): Promise<void>;
    remove(scope: string, key: string): Promise<void>;
    clear(scope: string): Promise<void>;
  };
  secrets?: {
    get(key: string): Promise<string | null>;
  };
  config?: {
    get(key: string): Promise<unknown | null>;
    all(): Promise<Record<string, string>>;
  };
}

// ---- Dispatcher context per RPC call -------------------------------------

export interface DispatcherContext {
  appId: string;
  manifest: ManifestV2;
  adapters: DispatcherAdapters;
}

// ---- Main dispatcher -----------------------------------------------------

export async function dispatchRpc(req: RpcRequest, ctx: DispatcherContext): Promise<RpcResponse> {
  try {
    const result = await runMethod(req.method, req.params, ctx);
    return { id: req.id, type: 'rpc-response', result };
  } catch (err) {
    if (err instanceof DispatcherError) {
      return { id: req.id, type: 'rpc-response', error: err.toRpcError() };
    }
    return {
      id: req.id,
      type: 'rpc-response',
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---- Per-method handlers -------------------------------------------------

async function runMethod(method: string, params: unknown, ctx: DispatcherContext): Promise<unknown> {
  const p = params as Record<string, unknown>;
  switch (method) {
    case 'app.handshake':
    case 'app.ping':
      return { version: 1, appId: ctx.appId };

    // --- db ---
    case 'db.list': {
      const col = expectStr(p, 'collection');
      enforce(checkDbRead(ctx.manifest.permissions, col));
      return ctx.adapters.db.list(col, p.opts ?? {});
    }
    case 'db.get': {
      const col = expectStr(p, 'collection');
      const id = expectStr(p, 'id');
      enforce(checkDbRead(ctx.manifest.permissions, col));
      return ctx.adapters.db.get(col, id);
    }
    case 'db.count': {
      const col = expectStr(p, 'collection');
      enforce(checkDbRead(ctx.manifest.permissions, col));
      return ctx.adapters.db.count(col, p.filter ?? {});
    }
    case 'db.create': {
      const col = expectStr(p, 'collection');
      enforce(checkDbWrite(ctx.manifest.permissions, col));
      return ctx.adapters.db.create(col, p.data ?? {});
    }
    case 'db.update': {
      const col = expectStr(p, 'collection');
      const id = expectStr(p, 'id');
      enforce(checkDbWrite(ctx.manifest.permissions, col));
      return ctx.adapters.db.update(col, id, p.patch ?? {});
    }
    case 'db.delete': {
      const col = expectStr(p, 'collection');
      const id = expectStr(p, 'id');
      enforce(checkDbWrite(ctx.manifest.permissions, col));
      return ctx.adapters.db.delete(col, id);
    }

    // --- ai ---
    case 'ai.complete': {
      enforce(checkAi(ctx.manifest.permissions, 'complete'));
      if (!ctx.adapters.ai) throw notSupported('ai.complete');
      return ctx.adapters.ai.complete(expectStr(p, 'prompt'), p.opts ?? {});
    }
    case 'ai.structured': {
      enforce(checkAi(ctx.manifest.permissions, 'structured'));
      throw notSupported('ai.structured (waiting on structured-gen integration)');
    }

    // --- workflow ---
    case 'workflow.run': {
      const id = expectStr(p, 'id');
      enforce(checkWorkflow(ctx.manifest.permissions, id));
      if (!ctx.adapters.workflow) throw notSupported('workflow.run');
      return ctx.adapters.workflow.run(id, p.input ?? {});
    }

    // --- deepsearch ---
    case 'deepsearch.start': {
      enforce(checkDeepSearch(ctx.manifest.permissions, 'start'));
      if (!ctx.adapters.deepsearch) throw notSupported('deepsearch.start');
      return ctx.adapters.deepsearch.start({
        query: expectStr(p, 'query'),
        sites: expectOptionalStringArray(p, 'sites'),
        goal: expectOptionalEnum(p, 'goal', ['browse', 'evidence', 'full-content', 'research-report']),
        pageMode: expectOptionalEnum(p, 'pageMode', ['takeover_active_page', 'managed_page']),
        strictness: expectOptionalEnum(p, 'strictness', ['strict', 'best_effort']),
        maxPages: expectOptionalPositiveInt(p, 'maxPages'),
        maxDepth: expectOptionalPositiveInt(p, 'maxDepth'),
        keepEvidence: expectOptionalBoolean(p, 'keepEvidence'),
        keepScreenshots: expectOptionalBoolean(p, 'keepScreenshots'),
      });
    }
    case 'deepsearch.getResult': {
      enforce(checkDeepSearch(ctx.manifest.permissions, 'read'));
      if (!ctx.adapters.deepsearch) throw notSupported('deepsearch.getResult');
      return ctx.adapters.deepsearch.getResult(expectStr(p, 'runId'));
    }
    case 'deepsearch.pause': {
      enforce(checkDeepSearch(ctx.manifest.permissions, 'control'));
      if (!ctx.adapters.deepsearch) throw notSupported('deepsearch.pause');
      return ctx.adapters.deepsearch.pause(expectStr(p, 'runId'));
    }
    case 'deepsearch.resume': {
      enforce(checkDeepSearch(ctx.manifest.permissions, 'control'));
      if (!ctx.adapters.deepsearch) throw notSupported('deepsearch.resume');
      return ctx.adapters.deepsearch.resume(expectStr(p, 'runId'));
    }
    case 'deepsearch.cancel': {
      enforce(checkDeepSearch(ctx.manifest.permissions, 'control'));
      if (!ctx.adapters.deepsearch) throw notSupported('deepsearch.cancel');
      return ctx.adapters.deepsearch.cancel(expectStr(p, 'runId'));
    }

    // --- notify ---
    case 'notify.toast': {
      ctx.adapters.notify?.toast(p);
      return null;
    }
    case 'notify.confirm': {
      if (!ctx.adapters.notify) throw notSupported('notify.confirm');
      return ctx.adapters.notify.confirm(expectStr(p, 'message'), p);
    }

    // --- storage ---
    case 'storage.get': {
      if (!ctx.adapters.storage) throw notSupported('storage.get');
      return ctx.adapters.storage.get(expectStr(p, 'scope'), expectStr(p, 'key'));
    }
    case 'storage.set': {
      if (!ctx.adapters.storage) throw notSupported('storage.set');
      await ctx.adapters.storage.set(expectStr(p, 'scope'), expectStr(p, 'key'), p.value);
      return null;
    }
    case 'storage.remove': {
      if (!ctx.adapters.storage) throw notSupported('storage.remove');
      await ctx.adapters.storage.remove(expectStr(p, 'scope'), expectStr(p, 'key'));
      return null;
    }
    case 'storage.clear': {
      if (!ctx.adapters.storage) throw notSupported('storage.clear');
      await ctx.adapters.storage.clear(expectStr(p, 'scope'));
      return null;
    }

    // --- secrets / config ---
    case 'secrets.get': {
      const key = expectStr(p, 'key');
      enforce(checkSecret(ctx.manifest.permissions, key));
      if (!ctx.adapters.secrets) throw notSupported('secrets.get');
      return ctx.adapters.secrets.get(key);
    }
    case 'config.get': {
      if (!ctx.adapters.config) throw notSupported('config.get');
      return ctx.adapters.config.get(expectStr(p, 'key'));
    }
    case 'config.all': {
      if (!ctx.adapters.config) throw notSupported('config.all');
      return ctx.adapters.config.all();
    }

    // --- files (stub for next session) ---
    case 'files.pick': {
      enforce(checkFiles(ctx.manifest.permissions, 'pick'));
      throw notSupported('files.pick (next session)');
    }
    case 'files.save': {
      enforce(checkFiles(ctx.manifest.permissions, 'save'));
      throw notSupported('files.save (next session)');
    }
    case 'files.read':
      throw notSupported('files.read (next session)');

    // --- streaming methods are not handled here (host invokes them differently) ---
    case 'db.watch.start':
    case 'ai.stream.start':
    case 'workflow.run.stream.start':
      throw notSupported(`${method} requires a streaming dispatcher; use dispatchStream.`);

    default:
      throw new DispatcherError({
        code: 'UNSUPPORTED',
        message: `unknown method: ${method}`,
      });
  }
}

// ---- Errors --------------------------------------------------------------

export class DispatcherError extends Error {
  code: ErrorCode;
  hint?: string;
  constructor(error: RpcError) {
    super(error.message);
    this.code = error.code;
    this.hint = error.hint;
  }
  toRpcError(): RpcError {
    return { code: this.code, message: this.message, ...(this.hint ? { hint: this.hint } : {}) };
  }
}

function notSupported(detail: string): DispatcherError {
  return new DispatcherError({
    code: 'UNSUPPORTED',
    message: `不支持的操作：${detail}`,
  });
}

function enforce(decision: { ok: boolean; code?: ErrorCode; message?: string; hint?: string }): void {
  if (decision.ok) return;
  throw new DispatcherError({
    code: decision.code ?? 'PERM_DENIED',
    message: decision.message ?? '操作被拒绝',
    hint: decision.hint,
  });
}

function expectStr(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new DispatcherError({
      code: 'VALIDATION',
      message: `参数 ${key} 必须是非空字符串。`,
    });
  }
  return v;
}

function expectOptionalStringArray(p: Record<string, unknown>, key: string): string[] | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new DispatcherError({
      code: 'VALIDATION',
      message: `参数 ${key} 必须是非空字符串数组。`,
    });
  }
  return v.map((item) => item.trim());
}

function expectOptionalEnum<T extends string>(
  p: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new DispatcherError({
      code: 'VALIDATION',
      message: `参数 ${key} 必须是以下值之一：${allowed.join(', ')}。`,
    });
  }
  return v as T;
}

function expectOptionalPositiveInt(p: Record<string, unknown>, key: string): number | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) <= 0) {
    throw new DispatcherError({
      code: 'VALIDATION',
      message: `参数 ${key} 必须是正整数。`,
    });
  }
  return v as number;
}

function expectOptionalBoolean(p: Record<string, unknown>, key: string): boolean | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') {
    throw new DispatcherError({
      code: 'VALIDATION',
      message: `参数 ${key} 必须是布尔值。`,
    });
  }
  return v;
}
