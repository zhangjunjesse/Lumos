"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  DeepSearchCookieStatus,
  DeepSearchPageMode,
  DeepSearchRecord,
  DeepSearchRunAction,
  DeepSearchRunRecord,
  DeepSearchSiteRecord,
  DeepSearchStrictness,
  DeepSearchWaitingLoginRecoveryResult,
} from '@/types/deepsearch';
import { useTranslation } from '@/hooks/useTranslation';
import { isDeepSearchSiteReady } from '@/lib/deepsearch/site-state';
import { ACTIVE_STATUSES, getTimestampValue } from './deepsearch-types';

interface SitesResponse { sites: DeepSearchSiteRecord[]; total: number }
interface RunsResponse { runs: DeepSearchRunRecord[]; total: number }

export function useDeepSearch() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sites, setSites] = useState<DeepSearchSiteRecord[]>([]);
  const [runs, setRuns] = useState<DeepSearchRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [selectedSite, setSelectedSite] = useState<DeepSearchSiteRecord | null>(null);
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [selectedSiteKeys, setSelectedSiteKeys] = useState<string[]>([]);
  const [pageMode] = useState<DeepSearchPageMode>('managed_page');
  const [strictness] = useState<DeepSearchStrictness>('best_effort');
  const [loading, setLoading] = useState(true);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteRecheckingKey, setSiteRecheckingKey] = useState('');
  const [siteOpeningKey, setSiteOpeningKey] = useState('');
  const [runSaving, setRunSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<DeepSearchRunAction | null>(null);
  const [autoRecoveryChecking, setAutoRecoveryChecking] = useState(false);
  const [autoRecoveryResuming, setAutoRecoveryResuming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const autoRecoveryLockRef = useRef(false);

  // Derived state
  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId) ?? null, [runs, selectedRunId]);
  const siteMap = useMemo(() => new Map(sites.map((s) => [s.siteKey, s])), [sites]);
  const siteNameMap = useMemo(() => new Map(sites.map((s) => [s.siteKey, s.displayName])), [sites]);
  const hasActiveRuns = useMemo(() => runs.some((r) => ACTIVE_STATUSES.includes(r.status)), [runs]);
  const waitingLoginRuns = useMemo(() => runs.filter((r) => r.status === 'waiting_login' && r.blockedSiteKeys.length > 0), [runs]);

  // All documents across all runs, sorted by fetchedAt desc
  const allRecords = useMemo(() => {
    const records: (DeepSearchRecord & { runQueryText: string })[] = [];
    for (const run of runs) {
      for (const rec of run.records) {
        records.push({ ...rec, runQueryText: run.queryText });
      }
    }
    return records.sort((a, b) => getTimestampValue(b.fetchedAt) - getTimestampValue(a.fetchedAt));
  }, [runs]);

  const selectedRecord = useMemo(
    () => allRecords.find((r) => r.id === selectedRecordId) ?? null,
    [allRecords, selectedRecordId],
  );

  const requestedRunId = searchParams.get('runId')?.trim() || '';

  // State helpers
  const applyRunsState = useCallback((nextRuns: DeepSearchRunRecord[]) => {
    setRuns(nextRuns);
    setSelectedRunId((cur) => (cur && nextRuns.some((r) => r.id === cur)) ? cur : (nextRuns[0]?.id ?? ''));
  }, []);

  const upsertSiteState = useCallback((next: DeepSearchSiteRecord) => {
    setSites((cur) => cur.map((s) => s.siteKey === next.siteKey ? next : s).sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }, []);

  const updateRunInState = useCallback((next: DeepSearchRunRecord) => {
    setRuns((cur) => {
      const updated = cur.map((r) => r.id === next.id ? next : r);
      return updated.some((r) => r.id === next.id) ? updated : [next, ...cur];
    });
  }, []);

  // Data loading
  const loadRuns = useCallback(async () => {
    const res = await fetch('/api/deepsearch/runs?limit=100');
    if (!res.ok) return;
    applyRunsState(((await res.json()) as RunsResponse).runs || []);
  }, [applyRunsState]);

  const loadRunDetail = useCallback(async (runId: string) => {
    const res = await fetch(`/api/deepsearch/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return;
    updateRunInState(((await res.json()) as { run: DeepSearchRunRecord }).run);
  }, [updateRunInState]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sitesRes, runsRes] = await Promise.all([fetch('/api/deepsearch/sites'), fetch('/api/deepsearch/runs?limit=100')]);
      if (!sitesRes.ok || !runsRes.ok) throw new Error(t('deepsearch.loadFailed'));
      const sitesData = (await sitesRes.json()) as SitesResponse;
      const runsData = (await runsRes.json()) as RunsResponse;
      setSites(sitesData.sites || []);
      applyRunsState(runsData.runs || []);
      setSelectedSiteKeys((cur) => {
        if (cur.length > 0) return cur;
        const first = sitesData.sites.find(isDeepSearchSiteReady);
        return first ? [first.siteKey] : (sitesData.sites[0] ? [sitesData.sites[0].siteKey] : []);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('deepsearch.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [applyRunsState, t]);

  // Effects
  useEffect(() => { loadData().catch(() => {}); }, [loadData]);

  useEffect(() => {
    if (requestedRunId && runs.some((r) => r.id === requestedRunId)) setSelectedRunId(requestedRunId);
  }, [requestedRunId, runs]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!hasActiveRuns) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadRuns().catch(() => {});
      if (selectedRunId) loadRunDetail(selectedRunId).catch(() => {});
    }, 3000);
    return () => window.clearInterval(interval);
  }, [hasActiveRuns, loadRunDetail, loadRuns, selectedRunId]);

  useEffect(() => {
    if (waitingLoginRuns.length === 0) {
      autoRecoveryLockRef.current = false;
      return undefined;
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || autoRecoveryLockRef.current || siteOpeningKey || siteRecheckingKey || actionLoading) return;
      autoRecoveryLockRef.current = true;
      setAutoRecoveryChecking(true);
      void (async () => {
        try {
          const res = await fetch('/api/deepsearch/runtime/recovery', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 100, runIds: waitingLoginRuns.map((r) => r.id) }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as DeepSearchWaitingLoginRecoveryResult;
          setSites(data.sites || []);
          applyRunsState(data.runs || []);
          if (data.resumedCount > 0) {
            setAutoRecoveryResuming(true);
            setNotice(t('deepsearch.autoRecoveryResumedCount', { n: data.resumedCount }));
          }
        } finally {
          setAutoRecoveryChecking(false);
          setAutoRecoveryResuming(false);
          autoRecoveryLockRef.current = false;
        }
      })();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [actionLoading, applyRunsState, siteOpeningKey, siteRecheckingKey, t, waitingLoginRuns]);

  // Handlers
  async function handleCreateRun() {
    if (!queryText.trim()) { setError(t('deepsearch.queryRequired')); return; }
    if (selectedSiteKeys.length === 0) { setError(t('deepsearch.noSitesSelected')); return; }
    setRunSaving(true);
    setError('');
    try {
      const res = await fetch('/api/deepsearch/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryText, siteKeys: selectedSiteKeys, pageMode, strictness, createdFrom: 'extensions' }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error || t('deepsearch.runFailed')); }
      const data = (await res.json()) as { run: DeepSearchRunRecord };
      setRuns((cur) => [data.run, ...cur.filter((r) => r.id !== data.run.id)]);
      setSelectedRunId(data.run.id);
      setQueryText('');
      setShowCreateForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('deepsearch.runFailed'));
    } finally {
      setRunSaving(false);
    }
  }

  async function handleRunAction(action: DeepSearchRunAction) {
    if (!selectedRun) return;
    setActionLoading(action);
    try {
      const res = await fetch(`/api/deepsearch/runs/${selectedRun.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) return;
      updateRunInState(((await res.json()) as { run: DeepSearchRunRecord }).run);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRecheckSite(siteKey: string) {
    setSiteRecheckingKey(siteKey);
    try {
      const res = await fetch(`/api/deepsearch/sites/${encodeURIComponent(siteKey)}/recheck`, { method: 'POST' });
      if (!res.ok) return;
      upsertSiteState(((await res.json()) as { site: DeepSearchSiteRecord }).site);
    } finally { setSiteRecheckingKey(''); }
  }

  async function handleOpenLoginSite(siteKey: string) {
    setSiteOpeningKey(siteKey);
    try {
      const res = await fetch(`/api/deepsearch/sites/${encodeURIComponent(siteKey)}/login`, { method: 'POST' });
      if (!res.ok) return;
      upsertSiteState(((await res.json()) as { site: DeepSearchSiteRecord }).site);
      router.push('/browser');
    } finally { setSiteOpeningKey(''); }
  }

  async function handleSaveSite(input: {
    siteKey: string; cookieValue: string; cookieStatus: DeepSearchCookieStatus;
    cookieExpiresAt: string | null; validationMessage: string; notes: string;
    minFetchCount: number;
  }) {
    setSiteSaving(true);
    try {
      const res = await fetch('/api/deepsearch/sites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { site: DeepSearchSiteRecord };
      setSites((cur) => cur.map((s) => s.siteKey === data.site.siteKey ? data.site : s).sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setSelectedSite(data.site);
      setSiteDialogOpen(false);
      setNotice(t('deepsearch.configSaved'));
    } finally { setSiteSaving(false); }
  }

  async function handleDeleteRun(runId: string) {
    try {
      const res = await fetch(`/api/deepsearch/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
      if (!res.ok) return;
      setRuns((cur) => {
        const next = cur.filter((r) => r.id !== runId);
        if (selectedRunId === runId) setSelectedRunId(next[0]?.id ?? '');
        return next;
      });
    } catch { /* ignore */ }
  }

  function toggleSite(siteKey: string, checked: boolean) {
    setSelectedSiteKeys((cur) => {
      const s = new Set(cur);
      checked ? s.add(siteKey) : s.delete(siteKey);
      return Array.from(s);
    });
  }

  return {
    sites, runs, selectedRun, selectedRunId, selectedRecord, selectedRecordId,
    selectedSite, siteDialogOpen, queryText, selectedSiteKeys, pageMode, strictness,
    loading, siteSaving, siteRecheckingKey, siteOpeningKey, runSaving, actionLoading,
    autoRecoveryChecking, autoRecoveryResuming, error, notice, showCreateForm,
    siteMap, siteNameMap, allRecords,
    setSelectedRunId, setSelectedRecordId, setSelectedSite, setSiteDialogOpen,
    setQueryText, setError, setShowCreateForm,
    toggleSite, handleCreateRun, handleRunAction, handleDeleteRun,
    handleRecheckSite, handleOpenLoginSite, handleSaveSite,
  };
}
