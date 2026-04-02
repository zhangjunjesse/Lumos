"use client";

import { ExternalLink, Loader2, LogIn, Pause, Play, Plus, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeepSearchRunAction, DeepSearchRunRecord, DeepSearchSiteRecord } from './deepsearch-types';
import { formatTimestamp, getStatusVariant } from './deepsearch-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/hooks/useTranslation';
import { DeepSearchSearchForm } from './DeepSearchSearchForm';

function cap(s: string) { return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(''); }

interface Props {
  runs: DeepSearchRunRecord[];
  selectedRun: DeepSearchRunRecord | null;
  selectedRunId: string;
  siteMap: Map<string, DeepSearchSiteRecord>;
  siteNameMap: Map<string, string>;
  actionLoading: DeepSearchRunAction | null;
  siteOpeningKey: string;
  siteRecheckingKey: string;
  autoRecoveryChecking: boolean;
  autoRecoveryResuming: boolean;
  showCreateForm: boolean;
  sites: DeepSearchSiteRecord[];
  queryText: string;
  selectedSiteKeys: string[];
  runSaving: boolean;
  onSelectRun: (id: string) => void;
  onRunAction: (action: DeepSearchRunAction) => void;
  onOpenLoginSite: (key: string) => void;
  onRecheckSite: (key: string) => void;
  onShowCreateForm: (show: boolean) => void;
  onQueryChange: (v: string) => void;
  onToggleSite: (key: string, checked: boolean) => void;
  onSubmit: () => void;
  onDeleteRun: (id: string) => void;
}

function TaskDetail({ run, siteNameMap, siteMap, actionLoading, siteOpeningKey, siteRecheckingKey, autoRecoveryChecking, onRunAction, onOpenLoginSite, onRecheckSite }: {
  run: DeepSearchRunRecord; siteNameMap: Map<string, string>; siteMap: Map<string, DeepSearchSiteRecord>;
  actionLoading: DeepSearchRunAction | null; siteOpeningKey: string; siteRecheckingKey: string; autoRecoveryChecking: boolean;
  onRunAction: (a: DeepSearchRunAction) => void; onOpenLoginSite: (k: string) => void; onRecheckSite: (k: string) => void;
}) {
  const { t } = useTranslation();
  const isActive = ['pending', 'running'].includes(run.status);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1 pr-3">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={getStatusVariant(run.status)} className="text-xs">
              {t(`deepsearch.status${cap(run.status)}` as Parameters<typeof t>[0])}
            </Badge>
            {isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            <span className="text-xs text-muted-foreground">{formatTimestamp(run.createdAt)}</span>
          </div>
          <p className="mt-2 text-sm font-medium leading-5">{run.queryText}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {run.siteKeys.map((k) => siteNameMap.get(k) ?? k).join(', ')}
          </p>
          {run.statusMessage ? (
            <p className={cn("mt-1 text-xs", isActive ? "text-primary font-medium" : "text-muted-foreground")}>
              {isActive ? <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> : null}
              {run.statusMessage}
            </p>
          ) : null}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onRunAction('pause')}
            disabled={!['pending', 'running', 'waiting_login'].includes(run.status) || actionLoading !== null}>
            <Pause className="h-3.5 w-3.5" /> {t('deepsearch.pause')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onRunAction('resume')}
            disabled={!['pending', 'paused', 'waiting_login'].includes(run.status) || actionLoading !== null}>
            <Play className="h-3.5 w-3.5" /> {t('deepsearch.resume')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={() => onRunAction('cancel')}
            disabled={['completed', 'partial', 'failed', 'cancelled'].includes(run.status) || actionLoading !== null}>
            <Square className="h-3.5 w-3.5" /> {t('deepsearch.cancel')}
          </Button>
        </div>

        {/* Waiting login */}
        {run.status === 'waiting_login' ? (
          <Alert>
            <LogIn className="h-4 w-4" />
            <AlertTitle className="flex items-center gap-2">
              {t('deepsearch.waitingLoginTitle')}
              {autoRecoveryChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </AlertTitle>
            <AlertDescription className="mt-2 space-y-2">
              <p className="text-xs">{t('deepsearch.waitingLoginDesc')}</p>
              {run.blockedSiteKeys.map((sk) => {
                const site = siteMap.get(sk);
                return (
                  <div key={sk} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <span className="text-xs font-medium">{site?.displayName ?? siteNameMap.get(sk) ?? sk}</span>
                    <div className="flex gap-1.5">
                      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onOpenLoginSite(sk)} disabled={siteOpeningKey === sk}>
                        {siteOpeningKey === sk ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                        {t('deepsearch.openLoginPage')}
                      </Button>
                      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onRecheckSite(sk)} disabled={siteRecheckingKey === sk}>
                        {siteRecheckingKey === sk ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                        {t('deepsearch.recheckLoginState')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Records summary */}
        <Separator />
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {t('deepsearch.recordsTitle')} ({run.records.length})
            {run.resultSummary ? ` · ${run.resultSummary}` : ''}
          </p>
          {run.records.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              {isActive ? (
                <div className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> 正在搜索中...</div>
              ) : t('deepsearch.noRecords')}
            </div>
          ) : (
            <div className="space-y-2">
              {run.records.map((rec) => (
                <div key={rec.id} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium leading-4 line-clamp-2">{rec.title || rec.url || '-'}</p>
                    <Badge variant={rec.contentState === 'full' ? 'default' : rec.contentState === 'failed' ? 'destructive' : 'secondary'} className="text-xs flex-shrink-0">
                      {t(`deepsearch.contentState${cap(rec.contentState)}` as Parameters<typeof t>[0])}
                    </Badge>
                  </div>
                  {rec.url ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground break-all select-all cursor-text">
                        {rec.url.length > 60 ? `${rec.url.slice(0, 60)}…` : rec.url}
                      </span>
                      <a href={rec.url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : null}
                  {rec.errorMessage ? <p className="text-xs text-destructive line-clamp-2">{rec.errorMessage}</p> : null}
                  {!rec.errorMessage && rec.snippet ? <p className="text-xs text-muted-foreground line-clamp-2">{rec.snippet}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

export function DeepSearchTasksTab(props: Props) {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: '300px minmax(0,1fr)' }}>
      {/* Left: create + list */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <Button variant={props.showCreateForm ? 'secondary' : 'default'} size="sm" className="w-full" onClick={() => props.onShowCreateForm(!props.showCreateForm)}>
          {props.showCreateForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {props.showCreateForm ? '收起' : t('deepsearch.createRun')}
        </Button>

        {props.showCreateForm ? (
          <div className="rounded-xl border bg-muted/20 p-3">
            <DeepSearchSearchForm
              sites={props.sites}
              queryText={props.queryText}
              selectedSiteKeys={props.selectedSiteKeys}
              loading={props.runSaving}
              onQueryChange={props.onQueryChange}
              onToggleSite={props.onToggleSite}
              onSubmit={props.onSubmit}
            />
          </div>
        ) : null}

        <ScrollArea className="flex-1 min-h-0">
          {props.runs.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">{t('deepsearch.noRuns')}</p>
          ) : (
            <div className="space-y-2 pr-2">
              {props.runs.map((run) => (
                <button key={run.id} type="button" onClick={() => props.onSelectRun(run.id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/50",
                    run.id === props.selectedRunId && "border-primary bg-primary/5",
                  )}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-xs font-medium">{run.queryText}</p>
                    <Badge variant={getStatusVariant(run.status)} className="flex-shrink-0 text-xs">
                      {t(`deepsearch.status${cap(run.status)}` as Parameters<typeof t>[0])}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {run.siteKeys.map((k) => props.siteNameMap.get(k) ?? k).join(', ')}
                    {' · '}{run.records.length} 条结果
                  </p>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{formatTimestamp(run.updatedAt)}</span>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          title="删除"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认删除</AlertDialogTitle>
                          <AlertDialogDescription>
                            删除后任务记录和抓取内容将无法恢复，确定要删除吗？
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => props.onDeleteRun(run.id)}>
                            删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: task detail */}
      <div className="min-h-0">
        {props.selectedRun ? (
          <TaskDetail
            run={props.selectedRun}
            siteNameMap={props.siteNameMap}
            siteMap={props.siteMap}
            actionLoading={props.actionLoading}
            siteOpeningKey={props.siteOpeningKey}
            siteRecheckingKey={props.siteRecheckingKey}
            autoRecoveryChecking={props.autoRecoveryChecking}
            onRunAction={props.onRunAction}
            onOpenLoginSite={props.onOpenLoginSite}
            onRecheckSite={props.onRecheckSite}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed">
            <p className="text-sm text-muted-foreground">{t('deepsearch.selectRun')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
