'use client';

import * as React from 'react';

import type { AppPage } from '@/lib/app/manifest/types';

import {
  BindingProvider,
  type DeclarativeBindingContext,
  useDbPrefetch,
} from './binding-context';
import type { RendererBridge } from './bridge';
import { FormLayout } from './layouts/FormLayout';
import { ListDetailLayout } from './layouts/ListDetailLayout';
import { ResultLayout } from './layouts/ResultLayout';
import { SingleLayout } from './layouts/SingleLayout';
import { collectReferencedCollections } from './page-collector';

/**
 * Top-level renderer for a parsed app page. Pre-fetches all referenced
 * `db.*` collections, sets up the binding context, then dispatches to the
 * correct layout component.
 */

export interface PageRendererProps {
  page: AppPage;
  bridge: RendererBridge;
  appId: string;
  /** Optional initial form/inputs values. */
  initialInputs?: Record<string, unknown>;
  /** Lumos user context, read-only. */
  user?: Record<string, unknown>;
  /** Non-secret config values; secrets stay in main process. */
  config?: Record<string, string>;
}

export function PageRenderer({
  page,
  bridge,
  appId,
  initialInputs,
  user,
  config,
}: PageRendererProps): React.ReactElement {
  const collections = React.useMemo(
    () => collectReferencedCollections(page),
    [page],
  );
  const { ready, snapshot, counts, refresh } = useDbPrefetch(bridge, collections);

  const [inputs, setInputs] = React.useState<Record<string, unknown>>(
    initialInputs ?? {},
  );
  const [stepOutputs, setStepOutputs] = React.useState<
    Record<string, { output?: unknown }>
  >({});

  const bindingValue: DeclarativeBindingContext = React.useMemo(
    () => ({
      inputs,
      user: user ?? {},
      steps: stepOutputs,
      dbSnapshot: snapshot,
      dbCounts: counts,
      config: config ?? {},
      appId,
    }),
    [inputs, user, stepOutputs, snapshot, counts, config, appId],
  );

  if (!ready) {
    return <PageSkeleton />;
  }

  return (
    <BindingProvider value={bindingValue}>
      <LayoutSwitch
        page={page}
        bridge={bridge}
        appId={appId}
        inputs={inputs}
        setInputs={setInputs}
        recordStepOutput={(stepId, output) =>
          setStepOutputs((s) => ({ ...s, [stepId]: { output } }))
        }
        refreshDb={refresh}
      />
    </BindingProvider>
  );
}

interface LayoutProps {
  page: AppPage;
  bridge: RendererBridge;
  appId: string;
  inputs: Record<string, unknown>;
  setInputs: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  recordStepOutput: (stepId: string, output: unknown) => void;
  refreshDb: () => Promise<void>;
}

function LayoutSwitch(props: LayoutProps): React.ReactElement {
  const { page } = props;
  switch (page.layout) {
    case 'single':
      return <SingleLayout {...props} />;
    case 'form':
      return <FormLayout {...props} />;
    case 'list-detail':
      return <ListDetailLayout {...props} />;
    case 'result':
      return <ResultLayout {...props} />;
    default: {
      const _exhaustive: never = page.layout;
      void _exhaustive;
      return (
        <div className="p-6 text-destructive">
          Unknown layout: {String(page.layout)}
        </div>
      );
    }
  }
}

function PageSkeleton(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

export type { LayoutProps };
