import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  appendDeepSearchRunPageBindings,
  createDeepSearchRun,
  dataDir,
  getDeepSearchArtifact,
  getDeepSearchSite,
  getDeepSearchSiteCookieValue,
  getDeepSearchRun,
  listDeepSearchRuns,
  listDeepSearchSites,
  replaceDeepSearchRunPageBindings,
  upsertDeepSearchSiteState,
  updateDeepSearchRunExecution,
  upsertDeepSearchSite,
  applyDeepSearchRunAction,
  deleteDeepSearchRun,
  appendDeepSearchRunResult,
} from '@/lib/db';
import {
  checkBrowserBridgeReady,
  getFromBrowserBridge,
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';
import { executeAdapterRun } from './execution';
import type { DeepSearchPageExtractionResult } from './adapter-types';
import { buildDeepSearchCookieImportEntries } from './cookie-source';
import {
  buildDeepSearchWaitingLoginRecoveryCopy,
  canResumeDeepSearchRunAfterProbe,
  deriveDeepSearchRunSiteProbeSummary,
} from './recovery';
import {
  resolveSiteSeedBindingRole,
  resolveSiteSeedUrl,
} from './site-routing';
import {
  validateDeepSearchSiteSessionFromPage,
  type DeepSearchSitePageValidationConfig,
} from './site-auth-validation';
import {
  DEEPSEARCH_PAGE_VALIDATION_BLOCKED,
  requiresManualPageValidation,
} from './site-state';
import type {
  CreateDeepSearchRunInput,
  DeepSearchBrowserBindingPreview,
  DeepSearchBrowserPageSummary,
  DeepSearchPageMode,
  DeepSearchRunAction,
  DeepSearchRunPageBinding,
  DeepSearchRunRecord,
  DeepSearchWaitingLoginRecoveryResult,
  DeepSearchWaitingLoginRecoveryOutcome,
  DeepSearchSiteLoginState,
  DeepSearchSiteUpsertInput,
} from '@/types';

interface BrowserBridgePagesResponse {
  ok: true;
  pages?: BrowserBridgePagePayload[];
  activePageId?: string | null;
}

interface BrowserBridgeCurrentPageResponse {
  ok: true;
  activePageId?: string | null;
  page?: BrowserBridgePagePayload | null;
}

interface BrowserBridgePageMutationResponse {
  ok: true;
  pageId: string;
}

interface BrowserBridgePageNavigateResponse {
  ok: true;
  pageId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _BrowserBridgePageSnapshotResponse {
  ok: true;
  pageId: string;
  url?: string;
  title?: string;
  lines?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _BrowserBridgePageScreenshotResponse {
  ok: true;
  pageId: string;
  filePath?: string;
}

interface BrowserBridgePageEvaluateResponse {
  ok: true;
  pageId: string;
  value?: unknown;
}

interface BrowserBridgePagePayload {
  pageId?: string;
  url?: string;
  title?: string;
  isActive?: boolean;
  isLoading?: boolean;
}

interface BrowserBridgeCookieSummaryResponse {
  ok: true;
  cookies?: BrowserBridgeCookiePayload[];
}

interface BrowserBridgeCookieImportResponse {
  ok: true;
  importedCount?: number;
}

interface BrowserBridgeCookiePayload {
  name?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number | null;
}

interface DeepSearchSiteProbeConfig {
  cookieDomains: string[];
  requiredCookieNames: string[];
  loginUrl?: string;
  validation?: DeepSearchSitePageValidationConfig;
}

const DEEPSEARCH_SITE_PROBE_CONFIG: Record<string, DeepSearchSiteProbeConfig> = {
  zhihu: {
    cookieDomains: ['.zhihu.com', 'www.zhihu.com'],
    requiredCookieNames: ['z_c0', 'd_c0'],
    loginUrl: 'https://www.zhihu.com/',
    validation: {
      validationUrl: 'https://www.zhihu.com/settings/profile',
      loginUrlPatterns: [/zhihu\.com\/signin/i],
      loggedOutTextHints: ['登录/注册', '扫码登录'],
    },
  },
  xiaohongshu: {
    cookieDomains: ['.xiaohongshu.com', 'www.xiaohongshu.com'],
    requiredCookieNames: ['web_session', 'a1'],
    loginUrl: 'https://www.xiaohongshu.com/',
  },
  juejin: {
    cookieDomains: ['.juejin.cn', 'juejin.cn'],
    requiredCookieNames: ['sessionid', 'sid_guard'],
    loginUrl: 'https://juejin.cn/',
    validation: {
      validationUrl: 'https://juejin.cn/user/center',
      loginUrlPatterns: [/juejin\.cn\/login/i],
      loggedOutTextHints: ['登录掘金', '立即登录'],
    },
  },
  wechat: {
    cookieDomains: ['.weixin.qq.com', 'mp.weixin.qq.com'],
    requiredCookieNames: [],
    loginUrl: 'https://mp.weixin.qq.com/',
    // No login validation needed — WeChat articles are public,
    // search is via Baidu and content extraction uses browser rendering.
  },
  x: {
    cookieDomains: ['.x.com', 'x.com', '.twitter.com', 'twitter.com'],
    requiredCookieNames: ['auth_token', 'ct0'],
    loginUrl: 'https://x.com/',
    validation: {
      validationUrl: 'https://x.com/settings/account',
      loginUrlPatterns: [/x\.com\/i\/flow\/login/i, /twitter\.com\/i\/flow\/login/i],
      loggedOutTextHints: ['sign in', 'log in', 'join today'],
    },
  },
};

function mapBrowserPageSummary(page: BrowserBridgePagePayload | null | undefined): DeepSearchBrowserPageSummary | null {
  if (!page?.pageId) {
    return null;
  }
  return {
    pageId: page.pageId,
    url: typeof page.url === 'string' ? page.url : '',
    title: typeof page.title === 'string' ? page.title : '',
    isActive: Boolean(page.isActive),
    isLoading: Boolean(page.isLoading),
  };
}

function canMatchSiteUrl(siteUrl: string, pageUrl: string): boolean {
  if (!siteUrl || !pageUrl) {
    return false;
  }

  try {
    const site = new URL(siteUrl);
    const page = new URL(pageUrl);
    return site.hostname === page.hostname || page.hostname.endsWith(`.${site.hostname}`);
  } catch {
    return pageUrl.startsWith(siteUrl);
  }
}

function isBrowserTabLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Maximum tab limit \(\d+\) reached/i.test(message);
}

function resolveBindingSiteKey(
  page: DeepSearchBrowserPageSummary,
  selectedSiteKeys: string[],
): string | null {
  if (!page.url) {
    return null;
  }

  const selectedSites = listDeepSearchSites().filter((site) => selectedSiteKeys.includes(site.siteKey));
  for (const site of selectedSites) {
    if (canMatchSiteUrl(site.baseUrl, page.url)) {
      return site.siteKey;
    }
  }
  return null;
}

function getCookieProbeConfig(siteKey: string, baseUrl: string): DeepSearchSiteProbeConfig {
  const predefined = DEEPSEARCH_SITE_PROBE_CONFIG[siteKey];
  if (predefined) {
    return predefined;
  }

  try {
    const hostname = new URL(baseUrl).hostname;
    return {
      cookieDomains: [hostname, `.${hostname}`],
      requiredCookieNames: [],
    };
  } catch {
    return {
      cookieDomains: [],
      requiredCookieNames: [],
    };
  }
}

function resolveSiteLoginUrl(siteKey: string, baseUrl: string): string {
  const loginUrl = getCookieProbeConfig(siteKey, baseUrl).loginUrl?.trim();
  if (loginUrl) {
    return loginUrl;
  }
  return baseUrl.trim() || 'about:blank';
}

function getActiveRunBindings(run: DeepSearchRunRecord): DeepSearchRunPageBinding[] {
  return run.pageBindings.filter((binding) => !binding.releasedAt);
}

function isCookieExpired(cookie: BrowserBridgeCookiePayload, nowSeconds = Date.now() / 1000): boolean {
  if (cookie.session) {
    return false;
  }
  if (typeof cookie.expirationDate !== 'number' || Number.isNaN(cookie.expirationDate)) {
    return false;
  }
  return cookie.expirationDate <= nowSeconds;
}

async function fetchBrowserCookiesForDomain(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
  domain: string,
): Promise<BrowserBridgeCookiePayload[]> {
  const payload = await getFromBrowserBridge<BrowserBridgeCookieSummaryResponse>(
    config,
    `/v1/cookies?domain=${encodeURIComponent(domain)}`,
  );
  return Array.isArray(payload.cookies) ? payload.cookies : [];
}

async function maybeImportConfiguredSiteCookies(params: {
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>;
  siteKey: string;
  baseUrl: string;
}): Promise<{ importedCount: number; error: string }> {
  const cookieValue = getDeepSearchSiteCookieValue(params.siteKey);
  if (!cookieValue) {
    return { importedCount: 0, error: '' };
  }

  const site = getDeepSearchSite(params.siteKey);
  if (!site) {
    return { importedCount: 0, error: `Unknown DeepSearch site: ${params.siteKey}` };
  }

  const loginUrl = resolveSiteLoginUrl(site.siteKey, params.baseUrl);
  const probeConfig = getCookieProbeConfig(site.siteKey, params.baseUrl);
  const cookies = buildDeepSearchCookieImportEntries({
    baseUrl: loginUrl,
    preferredDomains: probeConfig.cookieDomains,
    cookieHeader: cookieValue,
    cookieExpiresAt: site.cookieExpiresAt,
  });

  if (cookies.length === 0) {
    return {
      importedCount: 0,
      error: 'Configured cookie could not be parsed into browser cookie entries.',
    };
  }

  try {
    const response = await postToBrowserBridge<BrowserBridgeCookieImportResponse>(params.config, '/v1/cookies/import', {
      cookies,
    });
    return {
      importedCount: Math.max(0, response.importedCount ?? 0),
      error: '',
    };
  } catch (error) {
    return {
      importedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function maybeValidateSiteSessionByPage(params: {
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>;
  siteKey: string;
  baseUrl: string;
}): Promise<{ blocked: boolean; reason: string }> {
  const probeConfig = getCookieProbeConfig(params.siteKey, params.baseUrl);
  const validation = probeConfig.validation;
  const validationUrl = validation?.validationUrl?.trim();
  if (!validation || !validationUrl) {
    return { blocked: false, reason: '' };
  }

  let pageId: string | null = null;
  try {
    const created = await postToBrowserBridge<BrowserBridgePageMutationResponse>(params.config, '/v1/pages/new', {
      url: validationUrl,
    });
    pageId = created.pageId;
    const snapshot = await getPageContentCapture(params.config, pageId);
    const result = validateDeepSearchSiteSessionFromPage({
      url: snapshot?.url || validationUrl,
      title: snapshot?.title || '',
      text: snapshot?.text || '',
    }, validation);
    return result;
  } catch (error) {
    return {
      blocked: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (pageId) {
      try {
        await postToBrowserBridge<{ ok: true; closed?: boolean; pageId?: string }>(
          params.config,
          '/v1/pages/close',
          { pageId },
        );
      } catch {
        // Validation page cleanup is best-effort.
      }
    }
  }
}

async function probeDeepSearchSiteLoginState(
  siteKey: string,
  options?: {
    validatePage?: boolean;
    importConfiguredCookie?: boolean;
  },
): Promise<{
  siteKey: string;
  loginState: DeepSearchSiteLoginState;
  blockingReason: string;
  lastError: string;
}> {
  const site = getDeepSearchSite(siteKey);
  if (!site) {
    throw new Error(`Unknown DeepSearch site: ${siteKey}`);
  }

  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    const state = upsertDeepSearchSiteState({
      siteKey,
      displayName: site.displayName,
      loginState: 'error',
      blockingReason: 'Browser runtime config is missing.',
      lastError: 'BROWSER_RUNTIME_CONFIG_MISSING',
    });
    return {
      siteKey,
      loginState: state.loginState,
      blockingReason: state.blockingReason,
      lastError: state.lastError,
    };
  }

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) {
    const state = upsertDeepSearchSiteState({
      siteKey,
      displayName: site.displayName,
      loginState: 'error',
      blockingReason: 'Browser runtime is unavailable.',
      lastError: health.error || `BROWSER_BRIDGE_${health.status}`,
    });
    return {
      siteKey,
      loginState: state.loginState,
      blockingReason: state.blockingReason,
      lastError: state.lastError,
    };
  }

  const probeConfig = getCookieProbeConfig(site.siteKey, site.baseUrl);
  const importResult = options?.importConfiguredCookie
    ? await maybeImportConfiguredSiteCookies({
      config,
      siteKey: site.siteKey,
      baseUrl: site.baseUrl,
    })
    : { importedCount: 0, error: '' };
  try {
    const cookieGroups = await Promise.all(
      probeConfig.cookieDomains.map((domain) => fetchBrowserCookiesForDomain(config, domain)),
    );
    const cookies = cookieGroups.flat();
    const cookieNames = new Set(cookies.map((cookie) => cookie.name).filter((name): name is string => Boolean(name)));
    const requiredHits = probeConfig.requiredCookieNames.filter((cookieName) => cookieNames.has(cookieName));
    const expiredRequiredHits = cookies.filter((cookie) => {
      if (!cookie.name) {
        return false;
      }
      return probeConfig.requiredCookieNames.includes(cookie.name) && isCookieExpired(cookie);
    });

    let loginState: DeepSearchSiteLoginState = 'missing';
    let blockingReason = 'No shared login cookie was detected for this site.';
    let lastError = '';
    if (probeConfig.requiredCookieNames.length === 0) {
      // No login required for this site (e.g. WeChat public articles)
      loginState = 'connected';
      blockingReason = '';
    } else if (requiredHits.length > 0) {
      loginState = expiredRequiredHits.length === requiredHits.length ? 'expired' : 'connected';
      blockingReason = loginState === 'connected'
        ? ''
        : 'Only expired shared login cookies were detected for this site.';
    } else if (cookies.length > 0) {
      loginState = 'suspected_expired';
      blockingReason = 'Shared site cookies exist, but no known auth cookie was detected.';
    }
    if (loginState !== 'connected' && importResult.error) {
      blockingReason = `Configured cookie import failed: ${importResult.error}`;
      lastError = importResult.error;
    }
    if (
      loginState === 'connected'
      && !options?.validatePage
      && requiresManualPageValidation(site.liveState)
    ) {
      loginState = 'suspected_expired';
      blockingReason = site.liveState?.blockingReason || 'Manual page validation is still required for this site.';
    }
    if (loginState === 'connected' && options?.validatePage) {
      const validationResult = await maybeValidateSiteSessionByPage({
        config,
        siteKey: site.siteKey,
        baseUrl: site.baseUrl,
      });
      if (validationResult.blocked) {
        loginState = 'suspected_expired';
        blockingReason = validationResult.reason || 'Validation page still looks logged out.';
        lastError = DEEPSEARCH_PAGE_VALIDATION_BLOCKED;
      }
    }

    const state = upsertDeepSearchSiteState({
      siteKey,
      displayName: site.displayName,
      loginState,
      blockingReason,
      lastError: loginState === 'connected' ? '' : lastError,
    });
    return {
      siteKey,
      loginState: state.loginState,
      blockingReason: state.blockingReason,
      lastError: state.lastError,
    };
  } catch (error) {
    const state = upsertDeepSearchSiteState({
      siteKey,
      displayName: site.displayName,
      loginState: 'error',
      blockingReason: 'DeepSearch failed to inspect shared site cookies.',
      lastError: error instanceof Error ? error.message : String(error),
    });
    return {
      siteKey,
      loginState: state.loginState,
      blockingReason: state.blockingReason,
      lastError: state.lastError,
    };
  }
}

function sanitizeArtifactSegment(value: string, fallback: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized || fallback;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _buildExecutionMarkdown(params: {
  successes: Array<{
    siteKey: string | null;
    pageId: string;
    url: string;
    title: string;
    screenshotPath: string | null;
    lines: string[];
  }>;
  failures: Array<{
    siteKey: string | null;
    pageId: string;
    error: string;
  }>;
  uncoveredSiteKeys: string[];
}): string {
  const siteNameMap = new Map(listDeepSearchSites().map((site) => [site.siteKey, site.displayName]));
  const lines: string[] = ['## Execution Snapshot', ''];

  if (params.successes.length === 0) {
    lines.push('- No page snapshot was captured.');
  }

  for (const success of params.successes) {
    const siteLabel = success.siteKey ? (siteNameMap.get(success.siteKey) ?? success.siteKey) : 'Unmatched page';
    lines.push(`### ${siteLabel}`);
    lines.push(`- pageId: ${success.pageId}`);
    lines.push(`- url: ${success.url || '-'}`);
    lines.push(`- title: ${success.title || '-'}`);
    lines.push(`- screenshot: ${success.screenshotPath || '-'}`);
    if (success.lines.length > 0) {
      lines.push('- excerpt:');
      for (const textLine of success.lines.slice(0, 12)) {
        lines.push(`  - ${textLine}`);
      }
    }
    lines.push('');
  }

  if (params.failures.length > 0) {
    lines.push('## Execution Failures', '');
    for (const failure of params.failures) {
      const siteLabel = failure.siteKey ? (siteNameMap.get(failure.siteKey) ?? failure.siteKey) : 'Unmatched page';
      lines.push(`- ${siteLabel} | pageId=${failure.pageId} | error=${failure.error}`);
    }
    lines.push('');
  }

  if (params.uncoveredSiteKeys.length > 0) {
    lines.push('## Uncovered Sites', '');
    for (const siteKey of params.uncoveredSiteKeys) {
      lines.push(`- ${siteNameMap.get(siteKey) ?? siteKey}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function buildContentCaptureExpression(): string {
  return `(() => {
    const root = document.body || document.documentElement;
    const text = String(root?.innerText || '').replace(/\\u0000/g, '').trim();
    return {
      url: location.href || '',
      title: document.title || '',
      text: text.slice(0, 200000)
    };
  })()`;
}

function buildStructuredSnapshotContent(params: {
  pageId: string;
  siteKey: string | null;
  url: string;
  title: string;
  lines: string[];
  structuredData?: Record<string, unknown> | null;
}) {
  return JSON.stringify({
    pageId: params.pageId,
    siteKey: params.siteKey,
    url: params.url,
    title: params.title,
    lines: params.lines,
    structuredData: params.structuredData ?? null,
  }, null, 2);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _buildGenericExtractionResult(params: {
  fallbackUrl: string;
  fallbackTitle: string;
  snapshotLines: string[];
  contentCapture: { url: string; title: string; text: string } | null;
}): DeepSearchPageExtractionResult {
  const lines = params.snapshotLines;
  const contentText = params.contentCapture?.text.trim() || '';
  const url = params.contentCapture?.url || params.fallbackUrl;
  const title = params.contentCapture?.title || params.fallbackTitle;
  const snippetSource = contentText || lines.join('\n') || title || url;

  return {
    url,
    title,
    lines,
    contentText,
    contentState: contentText
      ? (contentText.length >= 1000 ? 'full' : 'partial')
      : (lines.length > 0 ? 'list_only' : 'failed'),
    snippet: snippetSource.slice(0, 600),
    evidenceCount: lines.length,
    structuredData: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _createManagedFollowUpBindings(params: {
  runId: string;
  siteKey: string;
  urls: string[];
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>;
}): Promise<DeepSearchRunPageBinding[]> {
  if (params.urls.length === 0) {
    return [];
  }

  const bindingInputs: Array<{
    pageId: string;
    siteKey: string;
    bindingType: 'managed_page';
    role: 'detail';
    initialUrl: string;
    lastKnownUrl: string;
    pageTitle: null;
  }> = [];

  for (const url of params.urls) {
    const created = await postToBrowserBridge<BrowserBridgePageMutationResponse>(params.config, '/v1/pages/new', {
      url,
      background: true,
    });
    bindingInputs.push({
      pageId: created.pageId,
      siteKey: params.siteKey,
      bindingType: 'managed_page',
      role: 'detail',
      initialUrl: url,
      lastKnownUrl: url,
      pageTitle: null,
    });
  }

  const updatedRun = appendDeepSearchRunPageBindings(params.runId, bindingInputs);
  const pageIds = new Set(bindingInputs.map((binding) => binding.pageId));
  return updatedRun.pageBindings.filter((binding) => !binding.releasedAt && pageIds.has(binding.pageId));
}

async function getPageContentCapture(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
  pageId: string,
  background?: boolean,
): Promise<{ url: string; title: string; text: string } | null> {
  try {
    const response = await postToBrowserBridge<BrowserBridgePageEvaluateResponse>(config, '/v1/pages/evaluate', {
      pageId,
      expression: buildContentCaptureExpression(),
      background,
    });
    const value = response.value as { url?: unknown; title?: unknown; text?: unknown } | undefined;
    if (!value || typeof value !== 'object') {
      return null;
    }
    return {
      url: typeof value.url === 'string' ? value.url : '',
      title: typeof value.title === 'string' ? value.title : '',
      text: typeof value.text === 'string' ? value.text : '',
    };
  } catch {
    return null;
  }
}

async function getCurrentBrowserPage(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
): Promise<DeepSearchBrowserPageSummary | null> {
  const payload = await getFromBrowserBridge<BrowserBridgeCurrentPageResponse>(config, '/v1/pages/current');
  return mapBrowserPageSummary(payload.page ?? null);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _syncTakeoverRunBinding(
  run: DeepSearchRunRecord,
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
): Promise<DeepSearchRunRecord> {
  if (run.pageMode !== 'takeover_active_page') {
    return run;
  }

  const currentPage = await getCurrentBrowserPage(config);
  if (!currentPage) {
    return run;
  }

  const activeBindings = getActiveRunBindings(run);
  const matchedSiteKey = resolveBindingSiteKey(currentPage, run.siteKeys);
  if (activeBindings.length === 1 && activeBindings[0]?.pageId === currentPage.pageId) {
    if (activeBindings[0]?.siteKey === matchedSiteKey) {
      return run;
    }
  }

  if (!matchedSiteKey) {
    if (activeBindings.length === 0) {
      return run;
    }
    return replaceDeepSearchRunPageBindings(run.id, []);
  }

  return replaceDeepSearchRunPageBindings(run.id, [{
    pageId: currentPage.pageId,
    siteKey: matchedSiteKey,
    bindingType: 'taken_over_active_page',
    role: 'seed',
    initialUrl: currentPage.url,
    lastKnownUrl: currentPage.url,
    pageTitle: currentPage.title,
  }]);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _ensureManagedRunBindings(
  run: DeepSearchRunRecord,
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
): Promise<DeepSearchRunRecord> {
  if (run.pageMode !== 'managed_page' || getActiveRunBindings(run).length > 0) {
    return run;
  }

  const selectedSites = listDeepSearchSites()
    .filter((site) => run.eligibleSiteKeys.includes(site.siteKey))
    .filter((site) => site.baseUrl.trim().length > 0);

  if (selectedSites.length === 0) {
    return run;
  }

  const bindings: Array<{
    pageId: string;
    siteKey: string;
    bindingType: 'managed_page';
    role: 'seed' | 'search';
    initialUrl: string;
    lastKnownUrl: string;
    pageTitle: string | null;
  }> = [];

  for (const site of selectedSites) {
    const seedUrl = resolveSiteSeedUrl(site.siteKey, site.baseUrl, run.queryText);
    const bindingRole = resolveSiteSeedBindingRole(site.siteKey, run.queryText);
    const created = await postToBrowserBridge<BrowserBridgePageMutationResponse>(config, '/v1/pages/new', {
      url: seedUrl,
      background: true,
    });
    bindings.push({
      pageId: created.pageId,
      siteKey: site.siteKey,
      bindingType: 'managed_page',
      role: bindingRole,
      initialUrl: seedUrl,
      lastKnownUrl: seedUrl,
      pageTitle: null,
    });
  }

  return appendDeepSearchRunPageBindings(run.id, bindings);
}

async function probeRunSites(
  run: DeepSearchRunRecord,
  options?: { importConfiguredCookie?: boolean },
): Promise<{
  eligibleSiteKeys: string[];
  blockedSiteKeys: string[];
  blockedReasons: string[];
}> {
  const probes = await Promise.all(run.siteKeys.map((siteKey) => probeDeepSearchSiteLoginState(siteKey, {
    importConfiguredCookie: options?.importConfiguredCookie,
  })));
  const eligibleSiteKeys = probes
    .filter((probe) => probe.loginState === 'connected')
    .map((probe) => probe.siteKey);
  const blockedSiteKeys = probes
    .filter((probe) => probe.loginState !== 'connected')
    .map((probe) => probe.siteKey);
  const siteNameMap = new Map(listDeepSearchSites().map((site) => [site.siteKey, site.displayName]));
  const blockedReasons = probes
    .filter((probe) => probe.loginState !== 'connected')
    .map((probe) => `${siteNameMap.get(probe.siteKey) ?? probe.siteKey}: ${probe.blockingReason || probe.loginState}`);

  return {
    eligibleSiteKeys,
    blockedSiteKeys,
    blockedReasons,
  };
}

async function probeDeepSearchSitesForRuns(runs: DeepSearchRunRecord[]) {
  const siteKeys = Array.from(new Set(runs.flatMap((run) => run.siteKeys)));
  if (siteKeys.length === 0) {
    return;
  }

  await Promise.all(siteKeys.map((siteKey) => probeDeepSearchSiteLoginState(siteKey)));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _persistSingleResult(
  runId: string,
  artifactDir: string,
  success: {
    runPageId: string;
    siteKey: string | null;
    pageId: string;
    url: string;
    title: string;
    screenshotPath: string | null;
    lines: string[];
    contentText: string;
    contentState: 'list_only' | 'partial' | 'full' | 'failed';
    snippet: string;
    evidenceCount: number;
    structuredData: Record<string, unknown> | null;
  },
): Promise<void> {
  const nowTs = new Date().toISOString().replace('T', ' ').split('.')[0];
  const recordId = crypto.randomUUID();
  const siteSegment = sanitizeArtifactSegment(success.siteKey || 'page', 'page');
  const pageSegment = sanitizeArtifactSegment(success.pageId, 'page');
  const contentValue = success.contentText.trim() || success.lines.join('\n').trim();
  const artifacts: Array<{
    id: string; recordId: string | null; kind: 'content' | 'screenshot' | 'structured_json';
    title: string; storagePath: string; mimeType: string; sizeBytes: number;
    metadata: Record<string, unknown> | null; createdAt: string;
  }> = [];
  let contentArtifactId: string | null = null;
  let screenshotArtifactId: string | null = null;

  if (contentValue) {
    const contentPath = path.join(artifactDir, `${siteSegment}-${pageSegment}-content.txt`);
    await fs.writeFile(contentPath, contentValue, 'utf-8');
    const contentStat = await fs.stat(contentPath);
    contentArtifactId = crypto.randomUUID();
    artifacts.push({
      id: contentArtifactId, recordId, kind: 'content',
      title: `${success.title || success.url || success.pageId} content`,
      storagePath: contentPath, mimeType: 'text/plain; charset=utf-8',
      sizeBytes: contentStat.size,
      metadata: { siteKey: success.siteKey, pageId: success.pageId, url: success.url, title: success.title },
      createdAt: nowTs,
    });
  }

  const structuredPath = path.join(artifactDir, `${siteSegment}-${pageSegment}-snapshot.json`);
  const structuredContent = buildStructuredSnapshotContent({
    pageId: success.pageId, siteKey: success.siteKey,
    url: success.url, title: success.title,
    lines: success.lines, structuredData: success.structuredData,
  });
  await fs.writeFile(structuredPath, structuredContent, 'utf-8');
  const structuredStat = await fs.stat(structuredPath);
  artifacts.push({
    id: crypto.randomUUID(), recordId, kind: 'structured_json',
    title: `${success.title || success.url || success.pageId} snapshot`,
    storagePath: structuredPath, mimeType: 'application/json',
    sizeBytes: structuredStat.size,
    metadata: { siteKey: success.siteKey, pageId: success.pageId, url: success.url, title: success.title },
    createdAt: nowTs,
  });

  if (success.screenshotPath) {
    try {
      const screenshotStat = await fs.stat(success.screenshotPath);
      screenshotArtifactId = crypto.randomUUID();
      artifacts.push({
        id: screenshotArtifactId, recordId, kind: 'screenshot',
        title: `${success.title || success.url || success.pageId} screenshot`,
        storagePath: success.screenshotPath, mimeType: 'image/png',
        sizeBytes: screenshotStat.size,
        metadata: { siteKey: success.siteKey, pageId: success.pageId, url: success.url, title: success.title },
        createdAt: nowTs,
      });
    } catch { /* screenshot file missing, skip */ }
  }

  appendDeepSearchRunResult({
    runId,
    record: {
      id: recordId, runPageId: success.runPageId, siteKey: success.siteKey,
      url: success.url, title: success.title, contentState: success.contentState,
      snippet: success.snippet.slice(0, 600), evidenceCount: success.evidenceCount,
      contentArtifactId, screenshotArtifactId, errorMessage: '', fetchedAt: nowTs,
    },
    artifacts,
  });
}

async function maybeExecuteDeepSearchRun(
  run: DeepSearchRunRecord,
  options?: { importConfiguredCookie?: boolean },
): Promise<DeepSearchRunRecord> {
  if (run.status !== 'pending') {
    return run;
  }

  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    return updateDeepSearchRunExecution({
      id: run.id,
      status: 'pending',
      statusMessage: 'Browser bridge runtime config is missing, so execution has not started.',
      resultSummary: 'Waiting for browser runtime before any page can be captured.',
      executionMarkdown: [
        '## Execution Snapshot',
        '',
        '- Browser runtime config is missing.',
      ].join('\n'),
    });
  }

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) {
    return updateDeepSearchRunExecution({
      id: run.id,
      status: 'pending',
      statusMessage: health.error
        ? `Browser bridge is unavailable, so execution has not started: ${health.error}`
        : `Browser bridge is unavailable, so execution has not started (status ${health.status}).`,
      resultSummary: 'Waiting for browser runtime before any page can be captured.',
      executionMarkdown: [
        '## Execution Snapshot',
        '',
        `- Browser runtime unavailable: ${health.error || `status ${health.status}`}.`,
      ].join('\n'),
    });
  }

  const probeResult = await probeRunSites(run, {
    importConfiguredCookie: options?.importConfiguredCookie,
  });
  if (probeResult.eligibleSiteKeys.length === 0) {
    return updateDeepSearchRunExecution({
      id: run.id,
      status: 'waiting_login',
      statusMessage: 'No selected site currently has a confirmed shared login state in the built-in browser.',
      resultSummary: 'Waiting for site login before runtime execution can continue.',
      executionMarkdown: [
        '## Login Probe',
        '',
        '- No selected site passed the shared-login probe.',
        ...probeResult.blockedReasons.map((reason) => `- ${reason}`),
      ].join('\n'),
      eligibleSiteKeys: [],
      blockedSiteKeys: probeResult.blockedSiteKeys,
    });
  }

  if (run.strictness === 'strict' && probeResult.blockedSiteKeys.length > 0) {
    return updateDeepSearchRunExecution({
      id: run.id,
      status: 'waiting_login',
      statusMessage: 'Strict mode is blocked because at least one selected site still lacks a confirmed shared login state.',
      resultSummary: 'Waiting for all selected sites to pass the login probe.',
      executionMarkdown: [
        '## Login Probe',
        '',
        '- Strict mode blocked execution because some sites failed the shared-login probe.',
        ...probeResult.blockedReasons.map((reason) => `- ${reason}`),
      ].join('\n'),
      eligibleSiteKeys: probeResult.eligibleSiteKeys,
      blockedSiteKeys: probeResult.blockedSiteKeys,
    });
  }

  // --- Adapter-based execution ---
  const startedAt = new Date().toISOString().replace('T', ' ').split('.')[0]!;
  await updateDeepSearchRunExecution({
    id: run.id,
    status: 'running',
    statusMessage: 'DeepSearch 正在启动…',
    resultSummary: '执行已开始',
    startedAt,
    eligibleSiteKeys: probeResult.eligibleSiteKeys,
    blockedSiteKeys: probeResult.blockedSiteKeys,
  });

  return executeAdapterRun({
    run: getDeepSearchRun(run.id) ?? run,
    config,
    eligibleSiteKeys: probeResult.eligibleSiteKeys,
    blockedSiteKeys: probeResult.blockedSiteKeys,
    startedAt,
  });
}

export async function getDeepSearchBrowserBindingPreview(
  pageMode: DeepSearchPageMode,
): Promise<DeepSearchBrowserBindingPreview> {
  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    return {
      pageMode,
      runtimeAvailable: false,
      canPrepare: false,
      reason: 'Browser bridge runtime config is missing.',
      activePage: null,
      pages: [],
    };
  }

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) {
    return {
      pageMode,
      runtimeAvailable: false,
      runtimeSource: config.source,
      canPrepare: false,
      reason: health.error || `Browser bridge is not ready (${health.status}).`,
      activePage: null,
      pages: [],
    };
  }

  const [pagesPayload, currentPayload] = await Promise.all([
    getFromBrowserBridge<BrowserBridgePagesResponse>(config, '/v1/pages'),
    getFromBrowserBridge<BrowserBridgeCurrentPageResponse>(config, '/v1/pages/current'),
  ]);
  const pages = Array.isArray(pagesPayload.pages)
    ? pagesPayload.pages.map(mapBrowserPageSummary).filter((item): item is DeepSearchBrowserPageSummary => Boolean(item))
    : [];
  const currentPage = mapBrowserPageSummary(currentPayload.page ?? null);
  const activePage = currentPage
    || pages.find((page) => page.pageId === pagesPayload.activePageId)
    || pages.find((page) => page.isActive)
    || null;

  if (pageMode === 'takeover_active_page') {
    return {
      pageMode,
      runtimeAvailable: true,
      runtimeSource: config.source,
      canPrepare: Boolean(activePage),
      ...(activePage
        ? { note: 'DeepSearch can take over the current active browser page at execution time.' }
        : { reason: 'No active browser page is available to take over right now.' }),
      activePage,
      pages,
    };
  }

  return {
    pageMode,
    runtimeAvailable: true,
    runtimeSource: config.source,
    canPrepare: true,
    note: 'DeepSearch will create and manage its own browser page at execution time.',
    activePage,
    pages,
  };
}

export async function listDeepSearchSitesView() {
  return listDeepSearchSites();
}

export async function saveDeepSearchSite(input: DeepSearchSiteUpsertInput) {
  const site = upsertDeepSearchSite(input);
  if (site.hasCookie && site.cookieStatus !== 'missing') {
    try {
      await probeDeepSearchSiteLoginState(site.siteKey, {
        importConfiguredCookie: true,
      });
    } catch {
      return getDeepSearchSite(site.siteKey) ?? site;
    }
  }
  return getDeepSearchSite(site.siteKey) ?? site;
}

export async function recheckDeepSearchSiteView(siteKey: string) {
  await probeDeepSearchSiteLoginState(siteKey, {
    validatePage: true,
    importConfiguredCookie: true,
  });
  return getDeepSearchSite(siteKey);
}

export async function openDeepSearchSiteLoginView(siteKey: string) {
  const site = getDeepSearchSite(siteKey);
  if (!site) {
    throw new Error(`Unknown DeepSearch site: ${siteKey}`);
  }

  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    throw new Error('Browser bridge runtime config is missing.');
  }

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) {
    throw new Error(health.error || `Browser bridge is unavailable (status ${health.status}).`);
  }

  const pagesPayload = await getFromBrowserBridge<BrowserBridgePagesResponse>(config, '/v1/pages');
  const pages = Array.isArray(pagesPayload.pages)
    ? pagesPayload.pages.map(mapBrowserPageSummary).filter((item): item is DeepSearchBrowserPageSummary => Boolean(item))
    : [];

  const existingPage = pages.find((page) => page.isActive && canMatchSiteUrl(site.baseUrl, page.url))
    || pages.find((page) => canMatchSiteUrl(site.baseUrl, page.url));
  const activePage = pages.find((page) => page.isActive)
    || (pagesPayload.activePageId ? pages.find((page) => page.pageId === pagesPayload.activePageId) : null)
    || null;
  const loginUrl = resolveSiteLoginUrl(site.siteKey, site.baseUrl);

  if (existingPage) {
    await postToBrowserBridge<BrowserBridgePageMutationResponse>(config, '/v1/pages/select', {
      pageId: existingPage.pageId,
    });
    return {
      site,
      page: existingPage,
      loginUrl: existingPage.url || loginUrl,
      openedNewPage: false,
    };
  }

  try {
    const created = await postToBrowserBridge<BrowserBridgePageMutationResponse>(config, '/v1/pages/new', {
      url: loginUrl,
    });
    const currentPage = await getCurrentBrowserPage(config);

    return {
      site,
      page: currentPage?.pageId === created.pageId
        ? currentPage
        : {
          pageId: created.pageId,
          url: loginUrl,
          title: '',
          isActive: true,
          isLoading: false,
        },
      loginUrl,
      openedNewPage: true,
    };
  } catch (error) {
    if (!isBrowserTabLimitError(error) || !activePage) {
      throw error;
    }

    const navigated = await postToBrowserBridge<BrowserBridgePageNavigateResponse>(
      config,
      '/v1/pages/navigate',
      {
        pageId: activePage.pageId,
        type: 'url',
        url: loginUrl,
      },
      { timeoutMs: 120_000 },
    );
    const currentPage = await getCurrentBrowserPage(config);

    return {
      site,
      page: currentPage?.pageId === navigated.pageId
        ? currentPage
        : {
          pageId: navigated.pageId,
          url: loginUrl,
          title: activePage.title,
          isActive: true,
          isLoading: false,
        },
      loginUrl,
      openedNewPage: false,
    };
  }
}

export async function listDeepSearchRunsView(limit = 50) {
  return listDeepSearchRuns(limit);
}

export async function getDeepSearchRunView(id: string) {
  return getDeepSearchRun(id);
}

export async function getDeepSearchArtifactView(id: string) {
  return getDeepSearchArtifact(id);
}

export async function reconcileDeepSearchWaitingRunsView(options?: {
  limit?: number;
  runIds?: string[];
}): Promise<DeepSearchWaitingLoginRecoveryResult> {
  const limit = Math.min(Math.max(Math.floor(options?.limit ?? 100), 1), 200);
  const requestedRunIds = new Set((options?.runIds ?? []).map((runId) => runId.trim()).filter(Boolean));
  const currentRuns = listDeepSearchRuns(limit);
  const candidateRuns = currentRuns.filter((run) => {
    if (run.status !== 'waiting_login') {
      return false;
    }
    if (requestedRunIds.size === 0) {
      return true;
    }
    return requestedRunIds.has(run.id);
  });

  if (candidateRuns.length === 0) {
    const runs = listDeepSearchRuns(limit);
    return {
      runs,
      sites: listDeepSearchSites(),
      checkedRunCount: 0,
      resumedCount: 0,
      waitingRunCount: runs.filter((run) => run.status === 'waiting_login').length,
      outcomes: [],
    };
  }

  await probeDeepSearchSitesForRuns(candidateRuns);
  const outcomes: DeepSearchWaitingLoginRecoveryOutcome[] = [];
  let resumedCount = 0;

  for (const candidateRun of candidateRuns) {
    const latestRun = getDeepSearchRun(candidateRun.id);
    if (!latestRun) {
      outcomes.push({
        runId: candidateRun.id,
        outcome: 'skipped',
        previousStatus: candidateRun.status,
        nextStatus: candidateRun.status,
        eligibleSiteKeys: candidateRun.eligibleSiteKeys,
        blockedSiteKeys: candidateRun.blockedSiteKeys,
        message: 'Run no longer exists.',
      });
      continue;
    }

    if (latestRun.status !== 'waiting_login') {
      outcomes.push({
        runId: latestRun.id,
        outcome: 'skipped',
        previousStatus: candidateRun.status,
        nextStatus: latestRun.status,
        eligibleSiteKeys: latestRun.eligibleSiteKeys,
        blockedSiteKeys: latestRun.blockedSiteKeys,
        message: latestRun.statusMessage,
      });
      continue;
    }

    const probe = deriveDeepSearchRunSiteProbeSummary(latestRun, listDeepSearchSites());
    if (!canResumeDeepSearchRunAfterProbe(latestRun, probe)) {
      const waitingCopy = buildDeepSearchWaitingLoginRecoveryCopy(latestRun, probe);
      const updatedRun = updateDeepSearchRunExecution({
        id: latestRun.id,
        status: 'waiting_login',
        statusMessage: waitingCopy.statusMessage,
        resultSummary: waitingCopy.resultSummary,
        executionMarkdown: waitingCopy.executionMarkdown,
        eligibleSiteKeys: probe.eligibleSiteKeys,
        blockedSiteKeys: probe.blockedSiteKeys,
      });
      outcomes.push({
        runId: updatedRun.id,
        outcome: 'still_blocked',
        previousStatus: candidateRun.status,
        nextStatus: updatedRun.status,
        eligibleSiteKeys: updatedRun.eligibleSiteKeys,
        blockedSiteKeys: updatedRun.blockedSiteKeys,
        message: updatedRun.statusMessage,
      });
      continue;
    }

    try {
      const resumedRun = await updateDeepSearchRunEntry(latestRun.id, 'resume', {
        importConfiguredCookie: false,
      });
      if (resumedRun.status !== 'waiting_login') {
        resumedCount += 1;
      }
      outcomes.push({
        runId: resumedRun.id,
        outcome: resumedRun.status === 'waiting_login' ? 'still_blocked' : 'resumed',
        previousStatus: candidateRun.status,
        nextStatus: resumedRun.status,
        eligibleSiteKeys: resumedRun.eligibleSiteKeys,
        blockedSiteKeys: resumedRun.blockedSiteKeys,
        message: resumedRun.statusMessage,
      });
    } catch (error) {
      outcomes.push({
        runId: latestRun.id,
        outcome: 'resume_failed',
        previousStatus: candidateRun.status,
        nextStatus: latestRun.status,
        eligibleSiteKeys: probe.eligibleSiteKeys,
        blockedSiteKeys: probe.blockedSiteKeys,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const runs = listDeepSearchRuns(limit);
  return {
    runs,
    sites: listDeepSearchSites(),
    checkedRunCount: candidateRuns.length,
    resumedCount,
    waitingRunCount: runs.filter((run) => run.status === 'waiting_login').length,
    outcomes,
  };
}

export async function createDeepSearchRunEntry(input: CreateDeepSearchRunInput): Promise<DeepSearchRunRecord> {
  let run: DeepSearchRunRecord;
  if (input.pageMode !== 'takeover_active_page') {
    run = createDeepSearchRun(input, {
      bindingNote: 'DeepSearch will allocate a managed browser page when execution begins.',
    });
    // Fire-and-forget: execute asynchronously so the API returns immediately
    void maybeExecuteDeepSearchRun(run, { importConfiguredCookie: true }).catch(() => {});
    return run;
  }

  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    run = createDeepSearchRun(input, {
      bindingNote: 'Browser bridge runtime config is missing, so no active page was captured for takeover at creation time.',
    });
    void maybeExecuteDeepSearchRun(run, { importConfiguredCookie: true }).catch(() => {});
    return run;
  }

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) {
    run = createDeepSearchRun(input, {
      bindingNote: health.error
        ? `Browser bridge was unavailable during creation: ${health.error}`
        : `Browser bridge was unavailable during creation (status ${health.status}).`,
    });
    void maybeExecuteDeepSearchRun(run, { importConfiguredCookie: true }).catch(() => {});
    return run;
  }

  try {
    const payload = await getFromBrowserBridge<BrowserBridgeCurrentPageResponse>(config, '/v1/pages/current');
    const currentPage = mapBrowserPageSummary(payload.page ?? null);
    if (!currentPage) {
      run = createDeepSearchRun(input, {
        bindingNote: 'No active browser page was focused when this run was created, so takeover has not been locked yet.',
      });
      void maybeExecuteDeepSearchRun(run, { importConfiguredCookie: true }).catch(() => {});
      return run;
    }

    const matchedSiteKey = resolveBindingSiteKey(currentPage, input.siteKeys);
    run = createDeepSearchRun(input, {
      pageBindings: [{
        pageId: currentPage.pageId,
        siteKey: matchedSiteKey,
        bindingType: 'taken_over_active_page',
        role: 'seed',
        initialUrl: currentPage.url,
        lastKnownUrl: currentPage.url,
        pageTitle: currentPage.title,
      }],
      bindingNote: matchedSiteKey
        ? `Captured the current active browser page for ${matchedSiteKey} at run creation time.`
        : 'Captured the current active browser page at run creation time, but it did not match a selected site.',
    });
    void maybeExecuteDeepSearchRun(run, { importConfiguredCookie: true }).catch(() => {});
    return run;
  } catch (error) {
    run = createDeepSearchRun(input, {
      bindingNote: `Failed to capture the current active page during creation: ${error instanceof Error ? error.message : String(error)}`,
    });
    void maybeExecuteDeepSearchRun(run, { importConfiguredCookie: true }).catch(() => {});
    return run;
  }
}

export async function updateDeepSearchRunEntry(
  id: string,
  action: DeepSearchRunAction,
  options?: { importConfiguredCookie?: boolean },
): Promise<DeepSearchRunRecord> {
  const run = applyDeepSearchRunAction(id, action);
  if (action === 'resume') {
    return maybeExecuteDeepSearchRun(run, {
      importConfiguredCookie: options?.importConfiguredCookie ?? false,
    });
  }
  return run;
}

export async function deleteDeepSearchRunEntry(id: string): Promise<boolean> {
  const artifactDir = path.join(dataDir, 'deepsearch-artifacts', id);
  const deleted = deleteDeepSearchRun(id);
  if (deleted) {
    await fs.rm(artifactDir, { recursive: true, force: true }).catch(() => {});
  }
  return deleted;
}
