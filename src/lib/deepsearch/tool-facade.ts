import { z } from 'zod';
import { getAdapter } from './adapter-registry';
import { createAdapterContext } from './adapter-context';
import { resolveBrowserBridgeRuntimeConfig } from '@/lib/browser-runtime/bridge-client';
import type {
  CreateDeepSearchRunInput,
  DeepSearchArtifactKind,
  DeepSearchRecordContentState,
  DeepSearchRunAction,
  DeepSearchRunRecord,
  DeepSearchRunStatus,
  DeepSearchSiteRecord,
} from '@/types';
import {
  createDeepSearchRunEntry,
  getDeepSearchRunView,
  listDeepSearchSitesView,
  updateDeepSearchRunEntry,
} from './service';
import { isDeepSearchSiteReady } from './site-state';
import { getSetting, getSession } from '@/lib/db';
import { archiveDeepSearchRun } from '@/lib/knowledge/deepsearch-importer';

const SITE_ALIASES: Record<string, string[]> = {
  zhihu: ['zhihu', '知乎'],
  xiaohongshu: ['xiaohongshu', 'xhs', '小红书'],
  juejin: ['juejin', '掘金'],
  wechat: ['wechat', 'weixin', '微信公众号', '公众号', '微信文章', '微信'],
  x: ['twitter', 'x/twitter', '推特', 'twitter/x'],
};

const deepSearchStartToolSchema = z.object({
  action: z.literal('start'),
  query: z.string().trim().min(1).max(4000),
  sites: z.array(z.string().trim().min(1)).max(10).optional(),
  goal: z.enum(['browse', 'evidence', 'full-content', 'research-report']).optional(),
  pageMode: z.enum(['takeover_active_page', 'managed_page']).optional(),
  strictness: z.enum(['strict', 'best_effort']).optional(),
  maxPages: z.number().int().positive().optional(),
  maxDepth: z.number().int().positive().optional(),
  keepEvidence: z.boolean().optional(),
  keepScreenshots: z.boolean().optional(),
  requestedBySessionId: z.string().trim().min(1).nullable().optional(),
}).strict();

const deepSearchRunControlToolSchema = z.object({
  runId: z.string().trim().min(1),
});

export const deepSearchToolRequestSchema = z.discriminatedUnion('action', [
  deepSearchStartToolSchema,
  deepSearchRunControlToolSchema.extend({
    action: z.literal('get_result'),
  }).strict(),
  deepSearchRunControlToolSchema.extend({
    action: z.literal('pause'),
  }).strict(),
  deepSearchRunControlToolSchema.extend({
    action: z.literal('resume'),
  }).strict(),
  deepSearchRunControlToolSchema.extend({
    action: z.literal('cancel'),
  }).strict(),
]);

export type DeepSearchToolRequest = z.infer<typeof deepSearchToolRequestSchema>;

function normalizeSiteToken(value: string): string {
  return value.trim().toLowerCase();
}

function getSiteHosts(site: DeepSearchSiteRecord): string[] {
  if (!site.baseUrl.trim()) {
    return [];
  }

  try {
    const hostname = new URL(site.baseUrl).hostname.toLowerCase();
    return [
      hostname,
      hostname.replace(/^www\./, ''),
    ].filter(Boolean);
  } catch {
    return [];
  }
}

function matchesSiteToken(site: DeepSearchSiteRecord, token: string): boolean {
  const normalizedToken = normalizeSiteToken(token);
  if (!normalizedToken) {
    return false;
  }

  const displayName = normalizeSiteToken(site.displayName);
  if (normalizedToken === normalizeSiteToken(site.siteKey) || normalizedToken === displayName) {
    return true;
  }

  if (displayName.includes(normalizedToken) || normalizedToken.includes(displayName)) {
    return true;
  }

  const aliases = SITE_ALIASES[site.siteKey] ?? [];
  if (aliases.some((alias) => normalizeSiteToken(alias) === normalizedToken)) {
    return true;
  }

  const hosts = getSiteHosts(site);
  return hosts.some((host) => host === normalizedToken || host.includes(normalizedToken) || normalizedToken.includes(host));
}

function inferSiteKeysFromQuery(query: string, sites: DeepSearchSiteRecord[]): string[] {
  const normalizedQuery = normalizeSiteToken(query);
  if (!normalizedQuery) {
    return [];
  }

  return sites
    .filter((site) => {
      const aliases = [
        site.siteKey,
        site.displayName,
        ...(SITE_ALIASES[site.siteKey] ?? []),
        ...getSiteHosts(site),
      ];
      return aliases.some((alias) => {
        const normalizedAlias = normalizeSiteToken(alias);
        if (!normalizedAlias) {
          return false;
        }
        if (normalizedAlias.length === 1) {
          return normalizedQuery === normalizedAlias
            || normalizedQuery.includes(` ${normalizedAlias} `)
            || normalizedQuery.includes(`/${normalizedAlias}`)
            || normalizedQuery.includes(`${normalizedAlias}/`)
            || normalizedQuery.includes(`(${normalizedAlias})`);
        }
        return normalizedQuery.includes(normalizedAlias);
      });
    })
    .map((site) => site.siteKey);
}

function getReadySiteKeys(sites: DeepSearchSiteRecord[]): string[] {
  return sites
    .filter((site) => isDeepSearchSiteReady(site))
    .map((site) => site.siteKey);
}

function dedupeSiteKeys(siteKeys: string[]): string[] {
  return Array.from(new Set(siteKeys));
}

function getAvailableSiteNames(sites: DeepSearchSiteRecord[]): string {
  return sites.map((site) => `${site.displayName} (${site.siteKey})`).join(', ');
}

function resolveRequestedSiteKeys(
  requestedSites: string[] | undefined,
  query: string,
  sites: DeepSearchSiteRecord[],
): { siteKeys: string[]; selectionNote: string | null } {
  if (requestedSites && requestedSites.length > 0) {
    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const token of requestedSites) {
      const found = sites.find((site) => matchesSiteToken(site, token));
      if (found) {
        matched.push(found.siteKey);
      } else {
        unmatched.push(token);
      }
    }

    const siteKeys = dedupeSiteKeys(matched);
    if (siteKeys.length === 0) {
      throw new Error(`Unknown DeepSearch sites: ${unmatched.join(', ')}. Available sites: ${getAvailableSiteNames(sites)}`);
    }

    if (unmatched.length > 0) {
      return {
        siteKeys,
        selectionNote: `Ignored unknown site tokens: ${unmatched.join(', ')}.`,
      };
    }

    return {
      siteKeys,
      selectionNote: null,
    };
  }

  const inferredSiteKeys = dedupeSiteKeys(inferSiteKeysFromQuery(query, sites));
  if (inferredSiteKeys.length > 0) {
    return {
      siteKeys: inferredSiteKeys,
      selectionNote: 'DeepSearch inferred target sites from the user request.',
    };
  }

  const readySiteKeys = getReadySiteKeys(sites);
  if (readySiteKeys.length > 0) {
    return {
      siteKeys: readySiteKeys,
      selectionNote: 'No explicit site was given, so DeepSearch used the currently login-ready tracked sites.',
    };
  }

  throw new Error('No DeepSearch site could be inferred from the request, and there are no login-ready tracked sites. Mention target sites explicitly or configure login in Extensions > DeepSearch first.');
}

function buildIgnoredOptions(input: z.infer<typeof deepSearchStartToolSchema>): string[] {
  const ignored: string[] = [];
  if (input.goal) {
    ignored.push(`goal=${input.goal} is not enforced by the current Phase 1 runtime.`);
  }
  if (typeof input.maxPages === 'number') {
    ignored.push(`maxPages=${input.maxPages} is not enforced by the current Phase 1 runtime.`);
  }
  if (typeof input.maxDepth === 'number') {
    ignored.push(`maxDepth=${input.maxDepth} is not enforced by the current Phase 1 runtime.`);
  }
  if (typeof input.keepEvidence === 'boolean') {
    ignored.push('keepEvidence is not configurable yet in the current Phase 1 runtime.');
  }
  if (typeof input.keepScreenshots === 'boolean') {
    ignored.push('keepScreenshots is not configurable yet in the current Phase 1 runtime.');
  }
  return ignored;
}

function buildRunDetailUrl(runId: string): string {
  return `/extensions?tab=deepsearch&runId=${encodeURIComponent(runId)}`;
}

function buildArtifactUrl(artifactId: string): string {
  return `/api/deepsearch/artifacts/${encodeURIComponent(artifactId)}`;
}

function buildNextActions(status: DeepSearchRunStatus): Array<'pause' | 'resume' | 'cancel'> {
  switch (status) {
    case 'pending':
    case 'running':
      return ['pause', 'cancel'];
    case 'paused':
      return ['resume', 'cancel'];
    case 'waiting_login':
      return ['resume', 'cancel'];
    default:
      return [];
  }
}

function buildSiteView(siteKey: string, sitesByKey: Map<string, DeepSearchSiteRecord>) {
  const site = sitesByKey.get(siteKey);
  return {
    siteKey,
    displayName: site?.displayName ?? siteKey,
    loginState: site?.liveState?.loginState ?? null,
    blockingReason: site?.liveState?.blockingReason || '',
    lastCheckedAt: site?.liveState?.lastCheckedAt ?? null,
  };
}

function buildArtifactStats(run: DeepSearchRunRecord): Record<DeepSearchArtifactKind, number> {
  const stats: Record<DeepSearchArtifactKind, number> = {
    content: 0,
    screenshot: 0,
    structured_json: 0,
    evidence_snippet: 0,
    html_snapshot: 0,
  };

  for (const artifact of run.artifacts) {
    stats[artifact.kind] += 1;
  }

  return stats;
}

function buildContentStateStats(run: DeepSearchRunRecord): Record<DeepSearchRecordContentState, number> {
  const stats: Record<DeepSearchRecordContentState, number> = {
    list_only: 0,
    partial: 0,
    full: 0,
    failed: 0,
  };

  for (const record of run.records) {
    stats[record.contentState] += 1;
  }

  return stats;
}

function buildRunView(
  run: DeepSearchRunRecord,
  sites: DeepSearchSiteRecord[],
  options?: {
    selectionNote?: string | null;
    ignoredOptions?: string[];
  },
) {
  const sitesByKey = new Map(sites.map((site) => [site.siteKey, site]));
  const detailUrl = buildRunDetailUrl(run.id);
  const blockedSites = run.blockedSiteKeys.map((siteKey) => buildSiteView(siteKey, sitesByKey));
  const eligibleSites = run.eligibleSiteKeys.map((siteKey) => buildSiteView(siteKey, sitesByKey));
  const selectedSites = run.siteKeys.map((siteKey) => buildSiteView(siteKey, sitesByKey));
  const artifactStats = buildArtifactStats(run);
  const contentStateStats = buildContentStateStats(run);

  return {
    runId: run.id,
    status: run.status,
    summary: run.resultSummary || run.statusMessage,
    statusMessage: run.statusMessage,
    query: run.queryText,
    pageMode: run.pageMode,
    strictness: run.strictness,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    selectedSites,
    eligibleSites,
    blockedSites,
    nextActions: buildNextActions(run.status),
    detailEntry: {
      kind: 'deepsearch_run',
      runId: run.id,
      uiUrl: detailUrl,
    },
    detailUrl,
    loginRecovery: run.status === 'waiting_login'
      ? {
          instruction: 'Finish login in Extensions > DeepSearch, recheck the blocked site, then resume this run.',
          blockedSites,
        }
      : null,
    recordStats: {
      totalRecords: run.records.length,
      contentStates: contentStateStats,
    },
    artifactStats: {
      totalArtifacts: run.artifacts.length,
      byKind: artifactStats,
    },
    sampleRecords: run.records.slice(0, 20).map((record) => ({
      recordId: record.id,
      siteKey: record.siteKey,
      title: record.title,
      url: record.url,
      contentState: record.contentState,
      snippet: record.snippet,
      errorMessage: record.errorMessage,
      fetchedAt: record.fetchedAt,
      contentArtifactId: record.contentArtifactId,
      contentArtifactUrl: record.contentArtifactId ? buildArtifactUrl(record.contentArtifactId) : null,
      screenshotArtifactId: record.screenshotArtifactId,
      screenshotArtifactUrl: record.screenshotArtifactId ? buildArtifactUrl(record.screenshotArtifactId) : null,
    })),
    ...(options?.selectionNote ? { siteSelectionNote: options.selectionNote } : {}),
    ...(options?.ignoredOptions && options.ignoredOptions.length > 0 ? { ignoredOptions: options.ignoredOptions } : {}),
  };
}

async function getRunOrThrow(runId: string): Promise<DeepSearchRunRecord> {
  const run = await getDeepSearchRunView(runId);
  if (!run) {
    throw new Error('DeepSearch run not found');
  }
  return run;
}

export async function startDeepSearchTool(input: z.infer<typeof deepSearchStartToolSchema>) {
  const sites = await listDeepSearchSitesView();
  const resolvedSites = resolveRequestedSiteKeys(input.sites, input.query, sites);
  const ignoredOptions = buildIgnoredOptions(input);

  const createInput: CreateDeepSearchRunInput = {
    queryText: input.query,
    siteKeys: resolvedSites.siteKeys,
    pageMode: input.pageMode ?? 'managed_page',
    strictness: input.strictness ?? 'best_effort',
    createdFrom: 'chat',
    requestedBySessionId: input.requestedBySessionId ?? null,
  };

  const run = await createDeepSearchRunEntry(createInput);
  const refreshedSites = await listDeepSearchSitesView();
  return {
    action: 'start',
    ...buildRunView(run, refreshedSites, {
      selectionNote: resolvedSites.selectionNote,
      ignoredOptions,
    }),
  };
}

export async function getDeepSearchToolResult(runId: string) {
  const [sites, run] = await Promise.all([
    listDeepSearchSitesView(),
    getRunOrThrow(runId),
  ]);

  const view = buildRunView(run, sites);

  if (
    (view.status === 'completed' || view.status === 'partial')
    && !run.archivedAt
  ) {
    const archiveMode = getSetting('deepsearch.archive_mode') ?? 'confirm';

    // In workflow context there's no UI to confirm — treat 'confirm' as 'auto'
    const isWorkflowSession = run.requestedBySessionId
      ? getSession(run.requestedBySessionId)?.mode === 'workflow'
      : false;

    if (archiveMode === 'auto' || (archiveMode === 'confirm' && isWorkflowSession)) {
      archiveDeepSearchRun(runId).catch((e: Error) =>
        console.error('[deepsearch] auto-archive failed:', e.message)
      );
    } else if (archiveMode === 'confirm') {
      return { action: 'get_result' as const, ...view, archivePrompt: true };
    }
    // 'disabled' → nothing
  }

  return { action: 'get_result' as const, ...view };
}

export async function controlDeepSearchToolRun(action: DeepSearchRunAction, runId: string) {
  const run = await updateDeepSearchRunEntry(runId, action, {
    importConfiguredCookie: action === 'resume' ? false : undefined,
  });
  const sites = await listDeepSearchSitesView();

  return {
    action,
    ...buildRunView(run, sites),
  };
}

export async function fetchAccountDataTool(site: string, dataType: string, limit?: number) {
  const adapter = getAdapter(site);
  if (!adapter.fetchAccountData) {
    throw new Error(`${site} 不支持账号数据获取`);
  }

  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    throw new Error('浏览器桥接未就绪，请确保 Lumos 桌面端正在运行');
  }

  const ctx = createAdapterContext(config);

  try {
    const result = await adapter.fetchAccountData(ctx, dataType, { limit });
    return {
      action: 'fetch_account_data' as const,
      site,
      dataType: result.dataType,
      total: result.total,
      count: result.items.length,
      hasMore: result.hasMore,
      items: result.items,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const authPattern = /未登录|登录已过期|请先登录|需要登录|expired|unauthorized|not logged in/i;
    return {
      action: 'fetch_account_data' as const,
      site,
      error: msg,
      loginRequired: authPattern.test(msg),
      loginUrl: `/extensions?tab=deepsearch`,
    };
  }
}
