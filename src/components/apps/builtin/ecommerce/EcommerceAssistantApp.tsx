'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { EcommerceHero } from './EcommerceHero';
import { SetupSection } from './SetupSection';
import { StudioTab } from './StudioTab';
import { JobsTab } from './JobsTab';
import { LibraryTab } from './LibraryTab';
import { PresetsTab } from './PresetsTab';
import { useEcommerceAppData } from './use-ecommerce-app-data';

import type { EcommerceTab } from './types';

const POLL_MS = 5_000;

export function EcommerceAssistantApp(): React.ReactElement {
  const [tab, setTab] = React.useState<EcommerceTab>('studio');
  const data = useEcommerceAppData();

  const dataRefresh = data.refresh;
  const refresh = React.useCallback(() => {
    void dataRefresh();
  }, [dataRefresh]);

  const hasActiveJobs = React.useMemo(
    () =>
      data.jobs.some(
        (job) => !['completed', 'failed', 'cancelled'].includes(job.status),
      ),
    [data.jobs],
  );

  // Lightweight polling: while there's at least one running / queued / non-terminal job,
  // refresh data every 5s so the UI keeps up with progress without manual reload.
  React.useEffect(() => {
    if (!hasActiveJobs) return undefined;
    const id = window.setInterval(() => void dataRefresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, dataRefresh]);

  const ready = !!data.status?.ready;
  const runningCount = data.jobs.filter(
    (job) => !['completed', 'failed', 'cancelled'].includes(job.status),
  ).length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <EcommerceHero
        status={data.status}
        loading={data.loading && !data.status}
        refreshing={data.refreshing}
        onRefresh={refresh}
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as EcommerceTab)} className="min-h-0 flex-1">
        <div className="overflow-x-auto border-b bg-muted/20">
          <TabsList className="mx-auto h-auto min-w-max gap-1 bg-transparent px-9 py-1.5">
            <TabPill value="studio" label="工坊" />
            <TabPill value="jobs" label="任务" badge={runningCount} />
            <TabPill value="library" label="资料库" />
            <TabPill value="presets" label="预设" />
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
          {data.statusError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle />
              <AlertDescription>{data.statusError}</AlertDescription>
            </Alert>
          ) : null}
          {!ready ? (
            <div className="mb-4">
              <SetupSection status={data.status} onRefresh={refresh} />
            </div>
          ) : null}

          <TabsContent value="studio" className="m-0">
            <StudioTab
              status={data.status}
              inputs={data.inputs}
              loading={data.loading}
              refreshing={data.refreshing}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="jobs" className="m-0">
            <JobsTab
              jobs={data.jobs}
              outputs={data.outputs}
              inputs={data.inputs}
              loading={data.loading}
              refreshing={data.refreshing}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="library" className="m-0">
            <LibraryTab
              jobs={data.jobs}
              outputs={data.outputs}
              inputs={data.inputs}
              loading={data.loading}
            />
          </TabsContent>
          <TabsContent value="presets" className="m-0">
            <PresetsTab presets={data.presets} onChanged={refresh} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function TabPill({
  value,
  label,
  badge,
}: {
  value: string;
  label: string;
  badge?: number;
}): React.ReactElement {
  return (
    <TabsTrigger
      value={value}
      className="group relative h-auto shrink-0 rounded-md bg-transparent px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border"
    >
      <span className="inline-flex items-baseline gap-1.5">
        {label}
        {badge && badge > 0 ? (
          <span className="rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground group-data-[state=active]:bg-foreground/10 group-data-[state=active]:text-foreground">
            {badge}
          </span>
        ) : null}
      </span>
    </TabsTrigger>
  );
}
