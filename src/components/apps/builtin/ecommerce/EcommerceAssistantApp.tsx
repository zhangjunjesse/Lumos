'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BottomChatPanel } from '@/components/layout/BottomChatPanel';

import { DiscoverTab } from './DiscoverTab';
import { ResearchTab } from './ResearchTab';
import { EcommerceHero } from './EcommerceHero';
import { ListingsTab } from './ListingsTab';
import { OverviewTab } from './OverviewTab';
import { ProductDetailDialog } from './ProductDetailDialog';
import { SetupSection } from './SetupSection';
import { StudioTab } from './StudioTab';
import { JobsTab } from './JobsTab';
import { LibraryTab } from './LibraryTab';
import { PresetsTab } from './PresetsTab';
import { EcommerceChatPanel } from './EcommerceChatPanel';
import { useEcommerceAppData } from './use-ecommerce-app-data';

import type { EcommerceTab, PipelineEntry } from './types';

const POLL_MS = 5_000;

export function EcommerceAssistantApp(): React.ReactElement {
  const [tab, setTab] = React.useState<EcommerceTab>('overview');
  const [detailEntry, setDetailEntry] = React.useState<PipelineEntry | null>(null);
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
            <TabPill value="overview" label="总览" />
            <TabPill value="research" label="调研" />
            <TabPill value="discover" label="选品" />
            <TabPill value="studio" label="工坊" />
            <TabPill value="jobs" label="任务" badge={runningCount} />
            <TabPill value="listings" label="上架" />
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

          <TabsContent value="overview" className="m-0">
            <OverviewTab
              snapshot={data.dashboard}
              pipelineCount={data.pipeline.length}
              loading={data.loading}
              onJump={(t) => setTab(t)}
            />
          </TabsContent>
          <TabsContent value="research" className="m-0">
            <ResearchTab
              reports={data.reports}
              loading={data.loading}
              refreshing={data.refreshing}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="discover" className="m-0">
            <DiscoverTab
              candidates={data.candidates}
              loading={data.loading}
              onChanged={refresh}
              onSwitchToStudio={() => setTab('studio')}
            />
          </TabsContent>
          <TabsContent value="studio" className="m-0">
            <StudioTab
              status={data.status}
              inputs={data.inputs}
              pipeline={data.pipeline}
              loading={data.loading}
              refreshing={data.refreshing}
              onChanged={refresh}
              onJump={(t) => setTab(t)}
              onOpenDetail={(e) => setDetailEntry(e)}
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
          <TabsContent value="listings" className="m-0">
            <ListingsTab
              inputs={data.inputs}
              drafts={data.drafts}
              loading={data.loading}
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

      <ProductDetailDialog
        open={!!detailEntry}
        entry={detailEntry}
        input={detailEntry ? data.inputs.find((i) => i.id === detailEntry.inputId) ?? null : null}
        outputs={data.outputs}
        jobs={data.jobs}
        drafts={data.drafts}
        candidate={
          detailEntry?.candidateId
            ? data.candidates.find((c) => c.id === detailEntry.candidateId) ?? null
            : null
        }
        onClose={() => setDetailEntry(null)}
      />

      <BottomChatPanel>
        {({ collapsed, expand }) => (
          <EcommerceChatPanel
            compactInputOnly={collapsed}
            onInputFocus={expand}
            onUpdated={refresh}
            fullWidth
            hideEmptyState
          />
        )}
      </BottomChatPanel>
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
