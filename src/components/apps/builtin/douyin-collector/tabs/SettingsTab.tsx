'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { useCollectorSettings } from '../use-collector-settings';
import { CookieSection } from './settings/CookieSection';
import { TranscribeSection } from './settings/TranscribeSection';
import {
  LibrarySection,
  type KnowledgeCollection,
} from './settings/LibrarySection';
import { RiskSection } from './settings/PromptsSection';
import { MaintenanceSection } from './settings/MaintenanceSection';

export function SettingsTab(): React.ReactElement {
  const { settings, loading, error, save, refresh } = useCollectorSettings();
  const [collections, setCollections] = React.useState<KnowledgeCollection[]>([]);
  const [collectionsErr, setCollectionsErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/knowledge/collections', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as KnowledgeCollection[];
        if (!cancelled) setCollections(Array.isArray(json) ? json : []);
      } catch (err) {
        if (!cancelled) {
          setCollectionsErr(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载设置…
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <CookieSection settings={settings} save={save} />
      <TranscribeSection settings={settings} save={save} />
      <LibrarySection
        settings={settings}
        save={save}
        collections={collections}
        collectionsErr={collectionsErr}
      />
      <RiskSection settings={settings} save={save} />
      <MaintenanceSection />

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          重新载入
        </Button>
      </div>
    </section>
  );
}
