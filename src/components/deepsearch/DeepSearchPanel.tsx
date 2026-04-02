"use client";

import { AlertCircle, FileText, ListTodo, Loader2, Radio } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/useTranslation';
import { useDeepSearch } from './use-deepsearch';
import { DeepSearchSiteDialog } from './DeepSearchSiteDialog';
import { DeepSearchSitesView } from './DeepSearchSitesView';
import { DeepSearchTasksTab } from './DeepSearchTasksTab';
import { DeepSearchDocsTab } from './DeepSearchDocsTab';

export function DeepSearchPanel() {
  const { t } = useTranslation();
  const ds = useDeepSearch();

  if (ds.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {ds.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('deepsearch.loadFailed')}</AlertTitle>
          <AlertDescription>{ds.error}</AlertDescription>
        </Alert>
      ) : null}
      {ds.notice ? <Alert><AlertTitle>{ds.notice}</AlertTitle></Alert> : null}

      <Tabs defaultValue="tasks" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListTodo className="h-3.5 w-3.5" />
            任务
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            文档
            {ds.allRecords.length > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">{ds.allRecords.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="sites" className="gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            {t('deepsearch.siteConfigs')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-3 flex min-h-0 flex-1">
          <DeepSearchTasksTab
            runs={ds.runs}
            selectedRun={ds.selectedRun}
            selectedRunId={ds.selectedRunId}
            siteMap={ds.siteMap}
            siteNameMap={ds.siteNameMap}
            actionLoading={ds.actionLoading}
            siteOpeningKey={ds.siteOpeningKey}
            siteRecheckingKey={ds.siteRecheckingKey}
            autoRecoveryChecking={ds.autoRecoveryChecking}
            autoRecoveryResuming={ds.autoRecoveryResuming}
            showCreateForm={ds.showCreateForm}
            sites={ds.sites}
            queryText={ds.queryText}
            selectedSiteKeys={ds.selectedSiteKeys}
            runSaving={ds.runSaving}
            onSelectRun={ds.setSelectedRunId}
            onRunAction={(a) => { ds.handleRunAction(a).catch(() => {}); }}
            onOpenLoginSite={(k) => { ds.handleOpenLoginSite(k).catch(() => {}); }}
            onRecheckSite={(k) => { ds.handleRecheckSite(k).catch(() => {}); }}
            onShowCreateForm={ds.setShowCreateForm}
            onQueryChange={ds.setQueryText}
            onToggleSite={ds.toggleSite}
            onSubmit={() => { ds.handleCreateRun().catch(() => {}); }}
            onDeleteRun={(id) => { ds.handleDeleteRun(id).catch(() => {}); }}
          />
        </TabsContent>

        <TabsContent value="docs" className="mt-3 flex min-h-0 flex-1">
          <DeepSearchDocsTab
            records={ds.allRecords}
            selectedRecordId={ds.selectedRecordId}
            selectedRecord={ds.selectedRecord}
            siteNameMap={ds.siteNameMap}
            onSelectRecord={ds.setSelectedRecordId}
          />
        </TabsContent>

        <TabsContent value="sites" className="mt-3 overflow-y-auto">
          <DeepSearchSitesView
            sites={ds.sites}
            siteRecheckingKey={ds.siteRecheckingKey}
            siteOpeningKey={ds.siteOpeningKey}
            onOpenLoginSite={(k) => { ds.handleOpenLoginSite(k).catch(() => {}); }}
            onRecheckSite={(k) => { ds.handleRecheckSite(k).catch(() => {}); }}
            onConfigureSite={(site) => { ds.setSelectedSite(site); ds.setSiteDialogOpen(true); }}
          />
        </TabsContent>
      </Tabs>

      <DeepSearchSiteDialog
        open={ds.siteDialogOpen}
        site={ds.selectedSite}
        loading={ds.siteSaving}
        onOpenChange={ds.setSiteDialogOpen}
        onSave={ds.handleSaveSite}
      />
    </div>
  );
}
