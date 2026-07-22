import type {
  AutomationDto,
  ParsedDto,
  ResultDto,
  RulesDto,
  RunDto,
  SettingsDto,
  StatusDto,
  WatchlistDto,
} from './types';

const BASE = '/api/apps/builtin/amazon-rank';

async function json<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !payload) {
    throw new Error(payload?.error || `请求失败（HTTP ${res.status}）`);
  }
  return payload;
}

export const api = {
  status: () => fetch(`${BASE}/status`, { cache: 'no-store' }).then((r) => json<StatusDto>(r)),

  parseText: (kind: 'keywords' | 'asins', text: string) =>
    fetch(`${BASE}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, text }),
    }).then((r) => json<ParsedDto>(r)),

  parseFile: (kind: 'keywords' | 'asins', file: File) => {
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    return fetch(`${BASE}/parse`, { method: 'POST', body: form }).then((r) => json<ParsedDto>(r));
  },

  listRuns: () =>
    fetch(`${BASE}/runs`, { cache: 'no-store' }).then((r) =>
      json<{ runs: RunDto[]; activeRunId: string | null }>(r),
    ),

  startRun: (keywords: string[], asins: string[]) =>
    fetch(`${BASE}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, asins }),
    }).then((r) => json<{ run: RunDto }>(r)),

  getRun: (id: string) =>
    fetch(`${BASE}/runs/${encodeURIComponent(id)}`, { cache: 'no-store' }).then((r) =>
      json<{ run: RunDto; results: ResultDto[] }>(r),
    ),

  stopRun: (id: string) =>
    fetch(`${BASE}/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' }).then((r) =>
      json<{ ok: boolean }>(r),
    ),

  exportUrl: (id: string) => `${BASE}/runs/${encodeURIComponent(id)}/export`,

  openSnapshot: (runId: string, resultId: string) =>
    fetch(`${BASE}/runs/${encodeURIComponent(runId)}/snapshot/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultId }),
    }).then((r) => json<{ ok: boolean; browserContextId: string }>(r)),

  settings: () =>
    fetch(`${BASE}/settings`, { cache: 'no-store' }).then((r) =>
      json<{ settings: SettingsDto; watchlist: WatchlistDto }>(r),
    ),

  saveSettings: (settings: Partial<SettingsDto>) =>
    fetch(`${BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    }).then((r) => json<{ settings: SettingsDto; watchlist: WatchlistDto }>(r)),

  rules: () => fetch(`${BASE}/rules`, { cache: 'no-store' }).then((r) => json<RulesDto>(r)),

  rulesAction: (action: 'adopt' | 'dismiss' | 'rollback', id?: string) =>
    fetch(`${BASE}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    }).then((r) => json<RulesDto & { resolvedTickets?: number }>(r)),

  setDailyMonitor: (keywords: string[], asins: string[]) =>
    fetch(`${BASE}/monitor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, asins }),
    }).then((r) => json<{ watchlist: WatchlistDto; automation: AutomationDto }>(r)),

  listAutomations: () =>
    fetch(`${BASE}/automations`, { cache: 'no-store' }).then((r) =>
      json<{ automations: AutomationDto[] }>(r),
    ),

  patchAutomation: (id: string, patch: { enabled?: boolean; schedule?: string }) =>
    fetch(`${BASE}/automations`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }).then((r) => json<{ automation: AutomationDto }>(r)),

  runAutomationNow: (rowId: string) =>
    fetch(`/api/apps/amazon-rank/native-actions/app/run-automation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId, confirmed: true }),
    }).then((r) => json<{ ok: boolean; message?: string }>(r)),

  syncAutomationSchedule: (rowId: string) =>
    fetch(`/api/apps/amazon-rank/native-actions/app/sync-automation-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId }),
    }).then((r) => json<{ ok: boolean; message?: string }>(r)),
};
