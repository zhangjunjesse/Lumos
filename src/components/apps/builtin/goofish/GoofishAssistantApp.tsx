'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BottomChatPanel } from '@/components/layout/BottomChatPanel';
import { GoofishChatPanel } from './GoofishChatPanel';

import { GoofishHero } from './GoofishHero';
import { OverviewTab } from './OverviewTab';
import { SetupBanner, SetupSection } from './SetupSection';
import { useGoofishOverview } from './use-goofish-overview';
import type { AppTab } from './goofish-types';

// Sibling tabs are owned by other agents; we only declare the imports + slot.
// Each peer module exports a named component to keep dynamic imports
// statically analyzable for tree-shaking.
import { AutoReplyTab } from './AutoReplyTab';
import { RemindersTab } from './RemindersTab';
import { SearchTab } from './SearchTab';
import { InboxTab } from './InboxTab';
import { DraftsTab } from './DraftsTab';
import { AutomationsTab } from './AutomationsTab';
import { SettingsTab } from './SettingsTab';

export function GoofishAssistantApp(): React.ReactElement {
  const [tab, setTab] = React.useState<AppTab>('overview');

  const {
    status,
    statusError,
    kpi,
    recentNotifications,
    draftsByDay,
    loading,
    refreshing,
    error,
    refresh,
  } = useGoofishOverview();

  const accounts = status?.auth.accounts ?? [];
  const loggedInCount = status?.auth.loggedInCount ?? 0;
  const ready = !!status?.ready;

  const refreshAll = React.useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <GoofishHero
          accounts={accounts}
          loggedInCount={loggedInCount}
          loading={loading && !status}
        />
        <SetupBanner status={status} onRefresh={refreshAll} />

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as AppTab)}
          className="min-h-0 flex-1"
        >
          <div className="overflow-x-auto border-b bg-muted/20">
            <TabsList className="mx-auto h-auto min-w-max gap-1 bg-transparent px-9 py-1.5">
              <TabPill value="overview" label="概况" />
              <TabPill value="inbox" label="收件箱" badge={kpi?.unreadInboxCount ?? 0} />
              <TabPill value="drafts" label="草稿" badge={kpi?.pendingConfirmCount ?? 0} />
              <TabPill
                value="auto-reply"
                label="自动回复"
              />
              <TabPill
                value="reminders"
                label="提醒"
                badge={kpi?.recentReminderCount ?? 0}
              />
              <TabPill value="search" label="搜索" />
              <TabPill value="automations" label="自动化" />
              <TabPill value="settings" label="设置" />
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
            {statusError ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertDescription>{statusError}</AlertDescription>
              </Alert>
            ) : null}
            {!ready ? (
              <div className="mb-4">
                <SetupSection
                  status={status}
                  onStatusRefresh={refreshAll}
                  defaultExpanded
                />
              </div>
            ) : null}

            <TabsContent value="overview" className="m-0">
              <OverviewTab
                kpi={kpi}
                recentNotifications={recentNotifications}
                loading={loading}
                refreshing={refreshing}
                error={error}
                ready={ready}
                draftsByDay={draftsByDay}
                onRefresh={refreshAll}
              />
            </TabsContent>

            <TabsContent value="inbox" className="m-0">
              <InboxTab />
            </TabsContent>

            <TabsContent value="drafts" className="m-0">
              <DraftsTab />
            </TabsContent>

            <TabsContent value="auto-reply" className="m-0">
              <AutoReplyTab />
            </TabsContent>

            <TabsContent value="reminders" className="m-0">
              <RemindersTab />
            </TabsContent>

            <TabsContent value="search" className="m-0">
              <SearchTab />
            </TabsContent>

            <TabsContent value="automations" className="m-0">
              <AutomationsTab />
            </TabsContent>

            <TabsContent value="settings" className="m-0">
              <SettingsTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <BottomChatPanel>
        {({ collapsed, expand }) => (
          <GoofishChatPanel
            compactInputOnly={collapsed}
            onInputFocus={expand}
            onUpdated={refreshAll}
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
