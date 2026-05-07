'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BottomChatPanel } from '@/components/layout/BottomChatPanel';

import { AutomationsTab } from './AutomationsTab';
import { FollowupsTab } from './FollowupsTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';
import { SetupBanner, SetupSection } from './SetupSection';
import { SyncBanner } from './SyncBanner';
import { WeChatChatPanel } from './WeChatChatPanel';
import { WeChatHero } from './WeChatHero';
import { DEFAULT_SETTINGS } from './app-settings';
import { refreshWeChatAssistantTargets } from './assistant-refresh';
import { useWeChatAutomations } from './use-wechat-automations';
import { useWeChatFollowups } from './use-wechat-followups';
import { useWeChatOverview } from './use-wechat-overview';
import { useWeChatSettings } from './use-wechat-settings';
import { useWeChatSync } from './use-wechat-sync';
import { useWeChatTopics } from './use-wechat-topics';
import type { CustomReport } from './custom-reports';
import type { ProviderOption } from './app-settings';
import type { OverviewData } from '@/lib/wechat-assistant/overview-types';
import type {
  Automation,
  Followup,
  Person,
} from './relations-types';
import type { AppTab, WeChatAssistantStatus } from './wechat-types';

const CUSTOM_REPORTS_STORAGE_KEY = 'lumos.wechatAssistant.customReports.v1';
const CUSTOM_REPORT_LIMIT = 20;

export function WeChatAssistantApp(): React.ReactElement {
  const [tab, setTab] = React.useState<AppTab>('overview');
  const [customReports, setCustomReports] = React.useState<CustomReport[]>([]);
  const [customReportsLoaded, setCustomReportsLoaded] = React.useState(false);
  const {
    settings: storedSettings,
    providers,
    saving,
    error: settingsError,
    update: updateSettings,
    retrySave: retrySettingsSave,
  } = useWeChatSettings();
  const appSettings = storedSettings ?? DEFAULT_SETTINGS;
  const overview = useWeChatOverview();
  const sync = useWeChatSync();
  const topics = useWeChatTopics();
  const followupState = useWeChatFollowups();
  const automationState = useWeChatAutomations();
  const followups = followupState.followups;
  const suggested = followupState.suggested;
  const automations = automationState.automations;
  const people = React.useMemo(
    () => buildPeopleFromOverview(overview.data),
    [overview.data],
  );
  const [selectedFollowupId, setSelectedFollowupId] = React.useState<string | null>(
    null,
  );

  const [status, setStatus] = React.useState<WeChatAssistantStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [setupExpanded, setSetupExpanded] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/apps/builtin/wechat/status', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as Partial<WeChatAssistantStatus> & {
        error?: string;
        message?: string;
      };
      if (!res.ok || !isWeChatAssistantStatus(json)) {
        throw new Error(json.message ?? json.error ?? '状态加载失败');
      }
      setStatus(json);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : '状态加载失败');
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    setCustomReports(loadStoredCustomReports());
    setCustomReportsLoaded(true);
  }, []);

  React.useEffect(() => {
    if (!customReportsLoaded) return;
    storeCustomReports(customReports);
  }, [customReports, customReportsLoaded]);

  const ready = !!status?.export.ready;

  // Auto-trigger first sync when consent + key are ready and we've never synced.
  // Subsequent syncs are user-driven via the banner button.
  const syncStartFn = sync.start;
  const syncState = sync.state;
  const syncRunning = sync.state?.inFlight || sync.progress?.phase === 'starting' || sync.progress?.phase === 'running';
  React.useEffect(() => {
    if (!ready) return;
    if (!syncState) return;
    if (syncState.cursorTs > 0) return;
    if (syncState.lastFinishedAt > 0) return;
    if (syncState.totalMessages > 0) return;
    if (syncState.inFlight) return;
    if (syncState.lastError) return;
    if (syncRunning) return;
    void syncStartFn();
  }, [ready, syncState, syncRunning, syncStartFn]);

  // Refresh overview when a sync run completes.
  const overviewRefresh = overview.refresh;
  const lastSyncFinishedAt = sync.state?.lastFinishedAt ?? 0;
  React.useEffect(() => {
    if (lastSyncFinishedAt > 0) void overviewRefresh();
  }, [lastSyncFinishedAt, overviewRefresh]);

  React.useEffect(() => {
    if (followups.length === 0) {
      setSelectedFollowupId(null);
      return;
    }
    setSelectedFollowupId((cur) => (
      cur && followups.some((item) => item.id === cur) ? cur : followups[0].id
    ));
  }, [followups]);

  const acceptSuggested = React.useCallback((suggestionId: string) => {
    followupState.acceptSuggestion(suggestionId);
    setSelectedFollowupId(suggestionId);
    setTab('followups');
  }, [followupState]);

  const dismissSuggested = React.useCallback((suggestionId: string) => {
    followupState.dismissSuggestion(suggestionId);
  }, [followupState]);

  const updateFollowup = React.useCallback((id: string, patch: Partial<Followup>) => {
    followupState.updateFollowup(id, patch);
  }, [followupState]);

  const deleteFollowup = React.useCallback((id: string) => {
    const target = followups.find((item) => item.id === id) ?? null;
    if (
      target
      && typeof window !== 'undefined'
      && !window.confirm(`删除跟进「${target.title}」？`)
    ) {
      return;
    }
    followupState.deleteFollowup(id);
    setSelectedFollowupId((cur) => (cur === id ? null : cur));
  }, [followupState, followups]);

  const createFollowup = React.useCallback(
    (draft: Omit<Followup, 'id' | 'createdAt' | 'updatedAt'>) => {
      followupState.createFollowup(draft);
    },
    [followupState],
  );

  const updateAutomation = React.useCallback((id: string, patch: Partial<Automation>) => {
    automationState.update(id, patch);
  }, [automationState]);

  const deleteAutomation = React.useCallback((id: string) => {
    const target = automations.find((item) => item.id === id) ?? null;
    if (
      target
      && typeof window !== 'undefined'
      && !window.confirm(`删除自动化「${target.name}」？正在执行的记录会尝试停止。`)
    ) {
      return;
    }
    automationState.remove(id);
  }, [automationState, automations]);

  const createAutomation = React.useCallback(
    (draft: Omit<Automation, 'id' | 'createdAt'>) => {
      return automationState.create(draft);
    },
    [automationState],
  );

  const addCustomReport = React.useCallback((report: CustomReport) => {
    setCustomReports((prev) => [report, ...prev].slice(0, CUSTOM_REPORT_LIMIT));
  }, []);

  const removeCustomReport = React.useCallback((id: string) => {
    setCustomReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const refreshAssistantTargets = React.useCallback(async () => {
    await refreshWeChatAssistantTargets({
      refreshFollowups: followupState.refresh,
      refreshAutomations: automationState.refresh,
      refreshOverview: overview.refresh,
    });
  }, [automationState.refresh, followupState.refresh, overview.refresh]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WeChatHero />
        <SetupBanner
          status={status}
          onRefresh={loadStatus}
          onOpenDetails={() => setSetupExpanded((v) => !v)}
          expanded={setupExpanded}
        />

        <Tabs value={tab} onValueChange={(value) => setTab(value as AppTab)} className="min-h-0 flex-1">
          <div className="overflow-x-auto border-b bg-muted/20">
            <TabsList className="mx-auto h-auto min-w-max gap-1 bg-transparent px-9 py-1.5">
              <TabPill value="overview" label="概况" />
              <TabPill value="followups" label="跟进" badge={openFollowupCount(followups)} />
              <TabPill
                value="automations"
                label="自动化"
                badge={automations.filter((a) => a.enabled).length}
              />
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
          {(setupExpanded || !ready) ? (
            <div className="mb-4">
              <SetupSection
                status={status}
                onStatusRefresh={loadStatus}
                defaultExpanded={setupExpanded || !ready}
              />
            </div>
          ) : null}

          <TabsContent value="overview" className="m-0">
            <div className="mb-4">
              <SyncBanner
                state={sync.state}
                progress={sync.progress}
                error={sync.error}
                hasEverSynced={sync.hasEverSynced}
                onSync={() => void sync.start()}
                onRebuild={() => {
                  if (
                    typeof window !== 'undefined'
                    && !window.confirm('清空本地微信分析镜像并重新同步？这不会删除微信原始数据，但会重新读取消息。')
                  ) {
                    return;
                  }
                  void sync.start({ fullResync: true });
                }}
                onRefresh={() => void sync.refresh()}
              />
            </div>
            <OverviewTab
              data={overview.data}
              loading={overview.loading}
              ready={overview.ready}
              reason={overview.reason}
              error={overview.error}
              analyzing={overview.analyzing}
              customReports={customReports}
              showInteractionRank={appSettings.overview.showInteractionRank}
              showHeatmap={appSettings.overview.showHeatmap}
              windowDays={appSettings.ai.windowDays}
              onAnalyze={() => void overview.refresh()}
              onAddReport={addCustomReport}
              onRemoveReport={removeCustomReport}
              searchRequest={null}
              topics={{
                showTopics: appSettings.overview.showTopics,
                hasProvider: hasResolvableTextProvider(providers, appSettings.ai.providerId),
                dateFrom: topics.dateFrom,
                dateTo: topics.dateTo,
                whitelistPersonalCount: effectiveWhitelistCount(
                  appSettings.topicAnalysis.whitelistPersonal,
                  appSettings.excludedPersonIds,
                ),
                whitelistGroupsCount: effectiveWhitelistCount(
                  appSettings.topicAnalysis.whitelistGroups,
                  appSettings.excludedPersonIds,
                ),
                personalSummary: topics.personal,
                groupSummary: topics.group,
                personalProgress: topics.progress.personal,
                groupProgress: topics.progress.group,
                onRunPersonal: () => void topics.runScope('personal', topics.dateTo),
                onRunGroup: () => void topics.runScope('group', topics.dateTo),
                onDateRangeChange: topics.setDateRange,
                onConfigureTopics: () => setTab('settings'),
              }}
            />
          </TabsContent>

          <TabsContent value="followups" className="m-0">
            <FollowupsTab
              followups={followups}
              people={people}
              automations={automations}
              suggested={suggested}
              loading={followupState.loading}
              saving={followupState.saving}
              canRetrySave={followupState.canRetrySave}
              analyzing={followupState.analyzing}
              error={followupState.error}
              selectedId={selectedFollowupId}
              onSelect={setSelectedFollowupId}
              onRunAnalysis={followupState.runAnalysis}
              onRetrySave={followupState.retrySave}
              onUpdate={updateFollowup}
              onDelete={deleteFollowup}
              onCreate={createFollowup}
              onCreateAutomation={createAutomation}
              onOpenAutomations={() => setTab('automations')}
              onAcceptSuggestion={acceptSuggested}
              onDismissSuggestion={dismissSuggested}
              defaultReminderHour={appSettings.followups.defaultReminderHour}
            />
          </TabsContent>

          <TabsContent value="automations" className="m-0">
            <AutomationsTab
              automations={automations}
              followups={followups}
              systemAutomation={null}
              loading={automationState.loading}
              saving={automationState.saving}
              canRetrySave={automationState.canRetrySave}
              triggeringId={automationState.triggeringId}
              triggerMessage={automationState.triggerMessage}
              error={automationState.error}
              onRefresh={automationState.refresh}
              onRetrySave={automationState.retrySave}
              onUpdate={updateAutomation}
              onDelete={deleteAutomation}
              onCreate={createAutomation}
              onTrigger={automationState.trigger}
            />
          </TabsContent>

          <TabsContent value="settings" className="m-0">
            {storedSettings ? (
              <SettingsTab
                settings={storedSettings}
                providers={providers}
                saving={saving}
                error={settingsError}
                onChange={updateSettings}
                onRetrySave={retrySettingsSave}
              />
            ) : (
              <p className="px-1 py-12 text-center text-xs text-muted-foreground">加载设置中…</p>
            )}
          </TabsContent>
          </div>
        </Tabs>
      </div>

      <BottomChatPanel>
        {({ collapsed, expand }) => (
          <WeChatChatPanel
            compactInputOnly={collapsed}
            onInputFocus={expand}
            onUpdated={refreshAssistantTargets}
            fullWidth
            hideEmptyState
          />
        )}
      </BottomChatPanel>
    </div>
  );
}

function openFollowupCount(followups: Followup[]): number {
  return followups.filter((f) => f.status === 'open' || f.status === 'in_progress').length;
}

function TabPill({
  value,
  label,
  badge,
}: {
  value: string;
  label: string;
  badge?: number;
}) {
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

function loadStoredCustomReports(): CustomReport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_REPORTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomReport).slice(0, CUSTOM_REPORT_LIMIT);
  } catch {
    return [];
  }
}

function storeCustomReports(reports: CustomReport[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CUSTOM_REPORTS_STORAGE_KEY,
      JSON.stringify(reports.slice(0, CUSTOM_REPORT_LIMIT)),
    );
  } catch {
    // localStorage can fail in restricted contexts; losing ephemeral report
    // cards is preferable to breaking the whole assistant surface.
  }
}

function isCustomReport(value: unknown): value is CustomReport {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CustomReport>;
  return (
    typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.prompt === 'string'
    && typeof item.createdAt === 'number'
    && (
      item.template === 'emoji'
      || item.template === 'night_chat'
      || item.template === 'commitment'
      || item.template === 'mention_week'
      || item.template === 'fallback'
    )
  );
}

function hasResolvableTextProvider(
  providers: ProviderOption[],
  providerId: string | null,
): boolean {
  if (providerId && providers.some((provider) => provider.id === providerId)) return true;
  if (providerId) return false;
  return providers.some((provider) => provider.isDefault);
}

function effectiveWhitelistCount(wxids: string[], excludedWxids: string[]): number {
  const excluded = new Set(excludedWxids);
  return wxids.filter((wxid) => !excluded.has(wxid)).length;
}

function buildPeopleFromOverview(data: OverviewData | null): Person[] {
  if (!data) return [];
  return data.rows.map((row) => ({
    id: row.id,
    wxid: row.id,
    name: row.name,
    isGroup: row.isGroup,
    groups: row.isGroup ? ['colleague'] : ['friend'],
    totalMessages30d: row.messageCount,
    yourShare30d: row.yourShare,
    lastInteractionTs: row.lastTs,
    interactionDays: row.interactionDays,
    topWords: [],
    toneTags: row.isGroup ? ['群聊'] : ['私聊'],
  }));
}

function isWeChatAssistantStatus(value: unknown): value is WeChatAssistantStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<WeChatAssistantStatus>;
  return (
    !!status.app
    && typeof status.app.id === 'string'
    && typeof status.app.name === 'string'
    && !!status.export
    && typeof status.export.supported === 'boolean'
    && typeof status.export.ready === 'boolean'
    && typeof status.export.phase === 'string'
    && !!status.im
    && typeof status.im.configured === 'boolean'
    && typeof status.im.enabled === 'boolean'
    && typeof status.im.isDefault === 'boolean'
  );
}
