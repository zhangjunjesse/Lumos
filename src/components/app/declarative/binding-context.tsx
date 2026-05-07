'use client';

import * as React from 'react';

import {
  type BindingContext,
  renderTemplate as renderTemplateRaw,
  resolveBindingExpression,
  resolveSingleBinding,
} from '@/lib/app/runtime/binding-resolver';

import type { RendererBridge } from './bridge';

/**
 * React-side binding plumbing.
 *
 * Server-side `BindingContext` wires directly to a SQLite-backed AppDataStore.
 * In the renderer process we substitute a bridge-backed read function: the
 * BindingContext's `dataStore.query/count` calls are routed through the
 * bridge. This file provides:
 *
 *   - `BindingProvider` — React context wrapping inputs / user / steps /
 *     prefetched db slices.
 *   - `useBindingContext()` — current snapshot.
 *   - `useResolvedTemplate(template)` — string render with reactive updates
 *     when inputs / steps change.
 *   - `useResolvedProp(template)` — raw value or string, depending on
 *     whether `template` is a single binding.
 *
 * **Db data**: page renderer prefetches `db.<collection>` results before
 * mount via the bridge and seeds them into the binding context's
 * `dbSnapshot`. A future improvement (M3+) will subscribe to mutations and
 * trigger refetches when create/update/delete events fire — for M1 we do a
 * coarse refetch after every mutating dispatch.
 */

export interface DeclarativeBindingContext {
  inputs: Record<string, unknown>;
  user: Record<string, unknown>;
  steps: Record<string, { output?: unknown }>;
  /** Precomputed collection snapshots, keyed by collection name. */
  dbSnapshot: Record<string, ReadonlyArray<Record<string, unknown> & { id: string }>>;
  /** Precomputed counts. */
  dbCounts: Record<string, number>;
  /** Non-secret config map; secrets are never sent to the renderer. */
  config: Record<string, string>;
  /** App id for telemetry / IPC. */
  appId: string;
}

const Ctx = React.createContext<DeclarativeBindingContext | null>(null);

export function BindingProvider({
  value,
  children,
}: {
  value: DeclarativeBindingContext;
  children: React.ReactNode;
}): React.ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBindingContext(): DeclarativeBindingContext {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error('useBindingContext must be used inside <BindingProvider>');
  }
  return ctx;
}

/**
 * Build a `BindingContext` (server-side type) backed by the renderer
 * snapshot. The data store proxy translates `dataStore.query/count` into
 * lookups against `dbSnapshot`/`dbCounts`.
 */
export function bindingContextFromSnapshot(
  snap: DeclarativeBindingContext,
): BindingContext {
  return {
    inputs: snap.inputs,
    user: snap.user,
    steps: snap.steps,
    appId: snap.appId,
    dataStore: {
      query: (collection: string) =>
        (snap.dbSnapshot[collection] ?? []).slice() as never,
      get: (collection: string, id: string) =>
        ((snap.dbSnapshot[collection] ?? []).find((r) => r.id === id) ?? null) as never,
      create: () => {
        throw new Error('Mutations cannot be performed inside a binding expression');
      },
      update: () => {
        throw new Error('Mutations cannot be performed inside a binding expression');
      },
      delete: () => {
        throw new Error('Mutations cannot be performed inside a binding expression');
      },
      count: (collection: string) =>
        snap.dbCounts[collection] ?? (snap.dbSnapshot[collection]?.length ?? 0),
    } as never,
    vault: {
      get: (_appId: string, key: string) => snap.config[key] ?? null,
    } as never,
  };
}

export function useResolvedTemplate(template: string): string {
  const ctx = useBindingContext();
  return React.useMemo(
    () => renderTemplateRaw(template, bindingContextFromSnapshot(ctx)),
    [template, ctx],
  );
}

export function useResolvedProp(template: string): unknown {
  const ctx = useBindingContext();
  return React.useMemo(() => {
    const single = resolveSingleBinding(template, bindingContextFromSnapshot(ctx));
    if (single.isSingle) return single.value;
    return renderTemplateRaw(template, bindingContextFromSnapshot(ctx));
  }, [template, ctx]);
}

export function useResolveExpression(): (expr: string) => unknown {
  const ctx = useBindingContext();
  return React.useCallback(
    (expr: string) => resolveBindingExpression(expr, bindingContextFromSnapshot(ctx)),
    [ctx],
  );
}

/**
 * Hook to fetch and cache `db.<collection>` snapshots used by the page.
 * Called by PageRenderer at mount.
 */
export function useDbPrefetch(
  bridge: RendererBridge,
  collections: string[],
): {
  ready: boolean;
  snapshot: Record<string, ReadonlyArray<Record<string, unknown> & { id: string }>>;
  counts: Record<string, number>;
  refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = React.useState<DeclarativeBindingContext['dbSnapshot']>({});
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [ready, setReady] = React.useState(collections.length === 0);

  const refresh = React.useCallback(async () => {
    if (collections.length === 0) {
      setReady(true);
      return;
    }
    const [rowsByColl, countByColl] = await Promise.all([
      Promise.all(collections.map((c) => bridge.dbQuery(c))),
      Promise.all(collections.map((c) => bridge.dbCount(c))),
    ]);
    const nextSnap: DeclarativeBindingContext['dbSnapshot'] = {};
    const nextCount: Record<string, number> = {};
    collections.forEach((c, i) => {
      nextSnap[c] = rowsByColl[i];
      nextCount[c] = countByColl[i];
    });
    setSnapshot(nextSnap);
    setCounts(nextCount);
    setReady(true);
  }, [bridge, collections]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ready, snapshot, counts, refresh };
}
