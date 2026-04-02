import type {
  DeepSearchRunRecord,
  DeepSearchSiteRecord,
  DeepSearchSiteStateRecord,
} from '@/types';

const mockAppendDeepSearchRunPageBindings = jest.fn();
const mockApplyDeepSearchRunAction = jest.fn();
const mockCreateDeepSearchRun = jest.fn();
const mockDataDir = jest.fn();
const mockGetDeepSearchArtifact = jest.fn();
const mockGetDeepSearchRun = jest.fn();
const mockGetDeepSearchSite = jest.fn();
const mockGetDeepSearchSiteCookieValue = jest.fn();
const mockListDeepSearchRuns = jest.fn();
const mockListDeepSearchSites = jest.fn();
const mockReplaceDeepSearchRunPageBindings = jest.fn();
const mockReplaceDeepSearchRunResults = jest.fn();
const mockUpdateDeepSearchRunExecution = jest.fn();
const mockUpsertDeepSearchSite = jest.fn();
const mockUpsertDeepSearchSiteState = jest.fn();

const mockCheckBrowserBridgeReady = jest.fn();
const mockGetFromBrowserBridge = jest.fn();
const mockPostToBrowserBridge = jest.fn();
const mockResolveBrowserBridgeRuntimeConfig = jest.fn();

jest.mock('@/lib/db', () => ({
  appendDeepSearchRunPageBindings: (...args: unknown[]) => mockAppendDeepSearchRunPageBindings(...args),
  applyDeepSearchRunAction: (...args: unknown[]) => mockApplyDeepSearchRunAction(...args),
  createDeepSearchRun: (...args: unknown[]) => mockCreateDeepSearchRun(...args),
  dataDir: (...args: unknown[]) => mockDataDir(...args),
  getDeepSearchArtifact: (...args: unknown[]) => mockGetDeepSearchArtifact(...args),
  getDeepSearchRun: (...args: unknown[]) => mockGetDeepSearchRun(...args),
  getDeepSearchSite: (...args: unknown[]) => mockGetDeepSearchSite(...args),
  getDeepSearchSiteCookieValue: (...args: unknown[]) => mockGetDeepSearchSiteCookieValue(...args),
  listDeepSearchRuns: (...args: unknown[]) => mockListDeepSearchRuns(...args),
  listDeepSearchSites: (...args: unknown[]) => mockListDeepSearchSites(...args),
  replaceDeepSearchRunPageBindings: (...args: unknown[]) => mockReplaceDeepSearchRunPageBindings(...args),
  replaceDeepSearchRunResults: (...args: unknown[]) => mockReplaceDeepSearchRunResults(...args),
  updateDeepSearchRunExecution: (...args: unknown[]) => mockUpdateDeepSearchRunExecution(...args),
  upsertDeepSearchSite: (...args: unknown[]) => mockUpsertDeepSearchSite(...args),
  upsertDeepSearchSiteState: (...args: unknown[]) => mockUpsertDeepSearchSiteState(...args),
}));

jest.mock('@/lib/browser-runtime/bridge-client', () => ({
  checkBrowserBridgeReady: (...args: unknown[]) => mockCheckBrowserBridgeReady(...args),
  getFromBrowserBridge: (...args: unknown[]) => mockGetFromBrowserBridge(...args),
  postToBrowserBridge: (...args: unknown[]) => mockPostToBrowserBridge(...args),
  resolveBrowserBridgeRuntimeConfig: (...args: unknown[]) => mockResolveBrowserBridgeRuntimeConfig(...args),
}));

import {
  openDeepSearchSiteLoginView,
  reconcileDeepSearchWaitingRunsView,
  recheckDeepSearchSiteView,
  saveDeepSearchSite,
  updateDeepSearchRunEntry,
} from '../service';

function createLiveState(overrides?: Partial<DeepSearchSiteStateRecord>): DeepSearchSiteStateRecord {
  return {
    siteKey: 'zhihu',
    displayName: 'Zhihu',
    loginState: 'missing',
    lastCheckedAt: '2026-03-28 10:00:00',
    lastLoginAt: null,
    blockingReason: '',
    lastError: '',
    createdAt: '2026-03-28 10:00:00',
    updatedAt: '2026-03-28 10:00:00',
    ...overrides,
  };
}

function createSite(overrides?: Partial<DeepSearchSiteRecord>): DeepSearchSiteRecord {
  return {
    id: 'site-1',
    siteKey: 'zhihu',
    displayName: 'Zhihu',
    baseUrl: 'https://www.zhihu.com/',
    cookieStatus: 'missing',
    hasCookie: false,
    cookiePreview: '',
    cookieExpiresAt: null,
    lastValidatedAt: null,
    validationMessage: '',
    notes: '',
    createdAt: '2026-03-28 10:00:00',
    updatedAt: '2026-03-28 10:00:00',
    liveState: null,
    ...overrides,
  };
}

function createRun(overrides?: Partial<DeepSearchRunRecord>): DeepSearchRunRecord {
  return {
    id: 'run-1',
    queryText: 'deepsearch',
    siteKeys: ['zhihu'],
    eligibleSiteKeys: [],
    blockedSiteKeys: ['zhihu'],
    pageMode: 'managed_page',
    strictness: 'strict',
    status: 'waiting_login',
    statusMessage: 'Waiting for login.',
    resultSummary: 'Waiting for login.',
    detailMarkdown: '## Login Probe',
    createdFrom: 'extensions',
    requestedBySessionId: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-03-28 10:00:00',
    updatedAt: '2026-03-28 10:00:00',
    pageBindings: [],
    records: [],
    artifacts: [],
    ...overrides,
  };
}

describe('deepsearch service auth flow', () => {
  let currentSite: DeepSearchSiteRecord;
  let currentState: DeepSearchSiteStateRecord | null;
  let currentRuns: DeepSearchRunRecord[];
  let bridgePosts: string[];

  beforeEach(() => {
    jest.clearAllMocks();

    currentSite = createSite();
    currentState = null;
    currentRuns = [];
    bridgePosts = [];

    mockResolveBrowserBridgeRuntimeConfig.mockReturnValue({
      baseUrl: 'http://127.0.0.1:3011',
      token: 'token',
      source: 'env',
    });
    mockCheckBrowserBridgeReady.mockResolvedValue({ ready: true, status: 200 });

    mockUpsertDeepSearchSite.mockImplementation((input: {
      cookieExpiresAt?: string | null;
      cookieStatus?: DeepSearchSiteRecord['cookieStatus'];
      cookieValue?: string | null;
      notes?: string;
      validationMessage?: string;
    }) => {
      const nextCookieValue = input.cookieValue ?? (currentSite.hasCookie ? 'persisted' : '');
      currentSite = createSite({
        ...currentSite,
        cookieStatus: input.cookieStatus ?? currentSite.cookieStatus,
        hasCookie: nextCookieValue.trim().length > 0,
        cookiePreview: nextCookieValue.trim() ? 'z_c0=t...-b' : '',
        cookieExpiresAt: input.cookieExpiresAt ?? currentSite.cookieExpiresAt,
        validationMessage: input.validationMessage ?? currentSite.validationMessage,
        notes: input.notes ?? currentSite.notes,
        liveState: currentState,
      });
      return { ...currentSite, liveState: currentState };
    });

    mockGetDeepSearchSite.mockImplementation((siteKey: string) => (
      siteKey === currentSite.siteKey
        ? { ...currentSite, liveState: currentState }
        : null
    ));

    mockGetDeepSearchSiteCookieValue.mockImplementation((siteKey: string) => (
      siteKey === currentSite.siteKey && currentSite.hasCookie
        ? 'z_c0=token-a; d_c0=token-b'
        : null
    ));

    mockUpsertDeepSearchSiteState.mockImplementation((input: {
      blockingReason?: string;
      displayName?: string;
      lastError?: string;
      loginState: DeepSearchSiteStateRecord['loginState'];
    }) => {
      currentState = createLiveState({
        displayName: input.displayName ?? currentSite.displayName,
        loginState: input.loginState,
        blockingReason: input.blockingReason ?? '',
        lastError: input.lastError ?? '',
        lastLoginAt: input.loginState === 'connected' ? '2026-03-28 10:00:00' : null,
      });
      return currentState;
    });

    mockListDeepSearchRuns.mockImplementation(() => currentRuns.map((run) => ({ ...run })));
    mockListDeepSearchSites.mockImplementation(() => [{ ...currentSite, liveState: currentState }]);
    mockGetDeepSearchRun.mockImplementation((runId: string) => {
      const run = currentRuns.find((candidate) => candidate.id === runId);
      return run ? { ...run } : null;
    });
    mockApplyDeepSearchRunAction.mockImplementation((runId: string, action: string) => {
      const current = currentRuns.find((candidate) => candidate.id === runId);
      if (!current) {
        throw new Error('DeepSearch run not found');
      }

      const nextStatus = action === 'resume'
        ? 'pending'
        : action === 'pause'
          ? 'paused'
          : 'cancelled';
      const nextRun = {
        ...current,
        status: nextStatus,
      } satisfies DeepSearchRunRecord;
      currentRuns = currentRuns.map((candidate) => (
        candidate.id === runId ? nextRun : candidate
      ));
      return nextRun;
    });
    mockUpdateDeepSearchRunExecution.mockImplementation((input: {
      blockedSiteKeys?: string[];
      eligibleSiteKeys?: string[];
      executionMarkdown?: string;
      id: string;
      resultSummary?: string;
      status?: DeepSearchRunRecord['status'];
      statusMessage?: string;
    }) => {
      currentRuns = currentRuns.map((run) => (
        run.id === input.id
          ? {
            ...run,
            status: input.status ?? run.status,
            statusMessage: input.statusMessage ?? run.statusMessage,
            resultSummary: input.resultSummary ?? run.resultSummary,
            detailMarkdown: input.executionMarkdown ?? run.detailMarkdown,
            eligibleSiteKeys: input.eligibleSiteKeys ?? run.eligibleSiteKeys,
            blockedSiteKeys: input.blockedSiteKeys ?? run.blockedSiteKeys,
          }
          : run
      ));
      return currentRuns.find((run) => run.id === input.id) ?? createRun();
    });
    mockReplaceDeepSearchRunPageBindings.mockImplementation((runId: string, bindings: Array<{
      attachedAt?: string | null;
      bindingType: 'taken_over_active_page' | 'managed_page';
      initialUrl?: string | null;
      lastKnownUrl?: string | null;
      pageId: string;
      pageTitle?: string | null;
      role?: 'seed' | 'search' | 'detail' | 'login';
      siteKey?: string | null;
    }>) => {
      currentRuns = currentRuns.map((run) => {
        if (run.id !== runId) {
          return run;
        }

        return {
          ...run,
          pageBindings: bindings.map((binding, index) => ({
            id: `binding-${index + 1}`,
            runId,
            pageId: binding.pageId,
            siteKey: binding.siteKey ?? null,
            bindingType: binding.bindingType,
            role: binding.role ?? 'seed',
            initialUrl: binding.initialUrl ?? null,
            lastKnownUrl: binding.lastKnownUrl ?? null,
            pageTitle: binding.pageTitle ?? null,
            attachedAt: binding.attachedAt ?? '2026-03-28 10:00:00',
            releasedAt: null,
          })),
        };
      });
      return currentRuns.find((run) => run.id === runId) ?? createRun();
    });

    mockPostToBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      bridgePosts.push(pathname);
      if (pathname === '/v1/cookies/import') {
        return { ok: true, importedCount: 2 };
      }
      if (pathname === '/v1/pages/new') {
        return { ok: true, pageId: 'page-validation' };
      }
      if (pathname === '/v1/pages/evaluate') {
        return {
          ok: true,
          pageId: 'page-validation',
          value: {
            url: 'https://www.zhihu.com/settings/profile',
            title: '我的资料 - 知乎',
            text: '个人信息 安全设置',
          },
        };
      }
      if (pathname === '/v1/pages/close') {
        return { ok: true, closed: true, pageId: 'page-validation' };
      }
      throw new Error(`Unexpected browser bridge POST: ${pathname}`);
    });

    mockGetFromBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      if (pathname.startsWith('/v1/cookies?')) {
        return {
          ok: true,
          cookies: [
            { name: 'z_c0', session: true },
            { name: 'd_c0', session: true },
          ],
        };
      }
      throw new Error(`Unexpected browser bridge GET: ${pathname}`);
    });
  });

  it('probes saved cookies on save without opening a validation tab', async () => {
    await saveDeepSearchSite({
      siteKey: 'zhihu',
      cookieValue: 'z_c0=token-a; d_c0=token-b',
      cookieStatus: 'valid',
      cookieExpiresAt: null,
      validationMessage: '',
      notes: '',
    });

    expect(bridgePosts).toContain('/v1/cookies/import');
    expect(bridgePosts).not.toContain('/v1/pages/new');
  });

  it('runs page validation only during explicit recheck', async () => {
    currentSite = createSite({
      cookieStatus: 'valid',
      hasCookie: true,
      cookiePreview: 'z_c0=t...-b',
    });

    await recheckDeepSearchSiteView('zhihu');

    expect(bridgePosts).toEqual(expect.arrayContaining([
      '/v1/cookies/import',
      '/v1/pages/new',
      '/v1/pages/evaluate',
      '/v1/pages/close',
    ]));
  });

  it('does not re-import saved cookies during background waiting-login reconciliation', async () => {
    currentSite = createSite({
      cookieStatus: 'valid',
      hasCookie: true,
      cookiePreview: 'z_c0=t...-b',
      liveState: createLiveState({
        loginState: 'missing',
        blockingReason: 'No shared login cookie was detected for this site.',
      }),
    });
    currentState = currentSite.liveState;
    currentRuns = [createRun()];

    mockGetFromBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      if (pathname.startsWith('/v1/cookies?')) {
        return {
          ok: true,
          cookies: [],
        };
      }
      throw new Error(`Unexpected browser bridge GET: ${pathname}`);
    });

    await reconcileDeepSearchWaitingRunsView({
      limit: 10,
      runIds: ['run-1'],
    });

    expect(bridgePosts).not.toContain('/v1/cookies/import');
  });

  it('does not re-import saved cookies during manual resume by default', async () => {
    currentSite = createSite({
      cookieStatus: 'valid',
      hasCookie: true,
      cookiePreview: 'z_c0=t...-b',
      liveState: createLiveState({
        loginState: 'missing',
        blockingReason: 'No shared login cookie was detected for this site.',
      }),
    });
    currentState = currentSite.liveState;
    currentRuns = [createRun({
      id: 'run-resume',
      status: 'paused',
      pageMode: 'managed_page',
    })];

    mockGetFromBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      if (pathname.startsWith('/v1/cookies?')) {
        return {
          ok: true,
          cookies: [],
        };
      }
      throw new Error(`Unexpected browser bridge GET: ${pathname}`);
    });

    await updateDeepSearchRunEntry('run-resume', 'resume');

    expect(bridgePosts).not.toContain('/v1/cookies/import');
  });

  it('clears stale takeover binding when the current active page no longer matches a selected site', async () => {
    currentSite = createSite({
      cookieStatus: 'valid',
      hasCookie: true,
      cookiePreview: 'z_c0=t...-b',
      liveState: createLiveState({
        loginState: 'connected',
        blockingReason: '',
      }),
    });
    currentState = currentSite.liveState;
    currentRuns = [createRun({
      id: 'run-takeover',
      status: 'paused',
      pageMode: 'takeover_active_page',
      eligibleSiteKeys: ['zhihu'],
      blockedSiteKeys: [],
      pageBindings: [{
        id: 'binding-old',
        runId: 'run-takeover',
        pageId: 'page-zhihu',
        siteKey: 'zhihu',
        bindingType: 'taken_over_active_page',
        role: 'seed',
        initialUrl: 'https://www.zhihu.com/question/1',
        lastKnownUrl: 'https://www.zhihu.com/question/1',
        pageTitle: '旧的知乎页面',
        attachedAt: '2026-03-28 10:00:00',
        releasedAt: null,
      }],
    })];

    mockGetFromBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      if (pathname.startsWith('/v1/cookies?')) {
        return {
          ok: true,
          cookies: [
            { name: 'z_c0', session: true },
            { name: 'd_c0', session: true },
          ],
        };
      }
      if (pathname === '/v1/pages/current') {
        return {
          ok: true,
          activePageId: 'page-other',
          page: {
            pageId: 'page-other',
            url: 'https://www.baidu.com/',
            title: '百度一下',
            isActive: true,
            isLoading: false,
          },
        };
      }
      throw new Error(`Unexpected browser bridge GET: ${pathname}`);
    });

    const updatedRun = await updateDeepSearchRunEntry('run-takeover', 'resume');

    expect(mockReplaceDeepSearchRunPageBindings).toHaveBeenCalledWith('run-takeover', []);
    expect(updatedRun.status).toBe('pending');
    expect(updatedRun.pageBindings).toHaveLength(0);
    expect(updatedRun.statusMessage).toContain('takeover-ready active page');
  });

  it('reuses the current active page for login when browser tabs already reached the limit', async () => {
    mockGetFromBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      if (pathname === '/v1/pages') {
        return {
          ok: true,
          activePageId: 'page-active',
          pages: [
            {
              pageId: 'page-active',
              url: 'https://example.com/current',
              title: 'Current Page',
              isActive: true,
              isLoading: false,
            },
          ],
        };
      }
      if (pathname === '/v1/pages/current') {
        return {
          ok: true,
          activePageId: 'page-active',
          page: {
            pageId: 'page-active',
            url: 'https://www.zhihu.com/',
            title: '知乎',
            isActive: true,
            isLoading: false,
          },
        };
      }
      if (pathname.startsWith('/v1/cookies?')) {
        return {
          ok: true,
          cookies: [],
        };
      }
      throw new Error(`Unexpected browser bridge GET: ${pathname}`);
    });

    mockPostToBrowserBridge.mockImplementation(async (_config: unknown, pathname: string) => {
      bridgePosts.push(pathname);
      if (pathname === '/v1/pages/new') {
        throw new Error('Maximum tab limit (10) reached');
      }
      if (pathname === '/v1/pages/navigate') {
        return { ok: true, pageId: 'page-active' };
      }
      throw new Error(`Unexpected browser bridge POST: ${pathname}`);
    });

    const result = await openDeepSearchSiteLoginView('zhihu');

    expect(bridgePosts).toEqual(['/v1/pages/new', '/v1/pages/navigate']);
    expect(result.page.pageId).toBe('page-active');
    expect(result.page.url).toBe('https://www.zhihu.com/');
    expect(result.openedNewPage).toBe(false);
  });
});
