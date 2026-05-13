'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { DouyinHero } from './DouyinHero';
import { OverviewTab } from './tabs/OverviewTab';
import { CollectTab } from './tabs/CollectTab';
import { LibraryTab } from './tabs/LibraryTab';
import { OrganizeTab } from './tabs/OrganizeTab';
import { AutomationsTab } from './tabs/AutomationsTab';
import { ImTab } from './tabs/ImTab';
import { SettingsTab } from './tabs/SettingsTab';
import { useDouyinStatus } from './use-douyin-status';
import type { DouyinCollectorTab } from './douyin-types';

const VALID_TABS: ReadonlySet<DouyinCollectorTab> = new Set([
  'overview',
  'collect',
  'library',
  'organize',
  'automations',
  'im',
  'settings',
]);

function isValidTab(value: string | null): value is DouyinCollectorTab {
  return value !== null && VALID_TABS.has(value as DouyinCollectorTab);
}

export function DouyinCollectorApp(): React.ReactElement {
  // URL `?tab=` drives tab — lets health-panel / setup-checklist deep-link
  // straight to "去配置" landing pages instead of telling users to navigate
  // tabs by hand. Falls back to 'overview' for invalid / missing values.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = searchParams?.get('tab');
  const [tab, setTabState] = React.useState<DouyinCollectorTab>(
    isValidTab(initialTab) ? initialTab : 'overview',
  );
  const setTab = React.useCallback(
    (value: DouyinCollectorTab) => {
      setTabState(value);
      // Mirror to URL so back/forward + bookmarks work. replace (not push)
      // to avoid bloating history with intra-app tab switches.
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (value === 'overview') params.delete('tab');
      else params.set('tab', value);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  // Re-sync state when the URL changes externally (e.g., a deep-link click
  // from another tab in the same window navigates back here with new ?tab).
  React.useEffect(() => {
    if (isValidTab(initialTab) && initialTab !== tab) {
      setTabState(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);
  const [pendingLibraryTag, setPendingLibraryTag] = React.useState<string | null>(null);
  const [pendingLibraryBacklog, setPendingLibraryBacklog] = React.useState<
    import('./use-videos').LibraryBacklogChip | null
  >(null);
  const [pendingLibraryCreator, setPendingLibraryCreator] = React.useState<
    { ref: string; label: string } | null
  >(null);
  const { status, loading, error, refresh } = useDouyinStatus();

  // Cross-tab navigation: HotTagsPanel + KeywordSection bubble tag clicks
  // up; OverviewTab.BacklogActionGrid bubbles backlog-chip clicks up.
  // Library absorbs both and clears them via consumed-callbacks.
  const requestLibraryFilter = React.useCallback((tagValue: string) => {
    setPendingLibraryTag(tagValue);
    setTab('library');
  }, []);
  const requestLibraryBacklog = React.useCallback(
    (key: import('./use-videos').LibraryBacklogChip) => {
      setPendingLibraryBacklog(key);
      setTab('library');
    },
    [],
  );
  const requestLibraryCreator = React.useCallback((ref: string, label: string) => {
    setPendingLibraryCreator({ ref, label });
    setTab('library');
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <DouyinHero status={status} loading={loading} />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DouyinCollectorTab)}
        className="min-h-0 flex-1"
      >
        <div className="overflow-x-auto border-b bg-muted/20">
          <TabsList className="mx-auto h-auto min-w-max gap-1 bg-transparent px-9 py-1.5">
            <TabPill value="overview" label="概况" />
            <TabPill
              value="collect"
              label="采集任务"
              badge={(status?.queue?.runningJobs ?? 0) + (status?.queue?.pendingJobs ?? 0)}
            />
            <TabPill value="library" label="资料库" badge={status?.library?.videos} />
            <TabPill
              value="organize"
              label="整理"
              // OrganizeTab scopes to unprocessed + draft (not just drafts).
              // Showing only `drafts` understates the real backlog.
              badge={(status?.library?.unprocessed ?? 0) + (status?.library?.drafts ?? 0)}
            />
            <TabPill value="automations" label="自动化" />
            <TabPill value="im" label="通知/命令" />
            <TabPill value="settings" label="设置" />
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <TabsContent value="overview" className="m-0">
            <OverviewTab
              status={status}
              loading={loading}
              onRefresh={refresh}
              onTagClick={requestLibraryFilter}
              onBacklogJump={requestLibraryBacklog}
            />
          </TabsContent>
          <TabsContent value="collect" className="m-0">
            <CollectTab
              onKeywordTagClick={requestLibraryFilter}
              onCreatorShowVideos={requestLibraryCreator}
              onOpenSettings={() => setTab('settings')}
            />
          </TabsContent>
          <TabsContent value="library" className="m-0">
            <LibraryTab
              initialTag={pendingLibraryTag}
              onConsumedInitialTag={() => setPendingLibraryTag(null)}
              initialBacklog={pendingLibraryBacklog}
              onConsumedInitialBacklog={() => setPendingLibraryBacklog(null)}
              initialCreator={pendingLibraryCreator}
              onConsumedInitialCreator={() => setPendingLibraryCreator(null)}
            />
          </TabsContent>
          <TabsContent value="organize" className="m-0">
            <OrganizeTab />
          </TabsContent>
          <TabsContent value="automations" className="m-0">
            <AutomationsTab />
          </TabsContent>
          <TabsContent value="im" className="m-0">
            <ImTab />
          </TabsContent>
          <TabsContent value="settings" className="m-0">
            <SettingsTab />
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
