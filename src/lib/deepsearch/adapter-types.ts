import type { DeepSearchRecordContentState } from '@/types';

// ---------------------------------------------------------------------------
// Adapter Context — transport layer provided to adapters
// ---------------------------------------------------------------------------

/** HTTP fetch response from /v1/fetch (Electron session cookies auto-attached) */
export interface AdapterFetchResponse {
  status: number;
  html: string;
  contentType: string;
}

/** Browser capture result (create hidden tab → evaluate JS → close) */
export interface AdapterBrowserCaptureResult {
  url: string;
  title: string;
  value: unknown;
  screenshotPath: string | null;
}

/** Transport context injected into every adapter call */
export interface AdapterContext {
  /** HTTP GET with Electron session cookies */
  fetch(url: string, options?: { headers?: Record<string, string> }): Promise<AdapterFetchResponse>;

  /** Full browser lifecycle: create hidden tab → wait stable → evaluate JS → screenshot → close */
  browserCapture(url: string, options?: {
    script?: string;
    screenshotPath?: string;
  }): Promise<AdapterBrowserCaptureResult>;
}

// ---------------------------------------------------------------------------
// Adapter Results
// ---------------------------------------------------------------------------

/** A single search result item */
export interface AdapterSearchItem {
  url: string;
  title: string;
  snippet: string;
  voteCount?: number;
  extra?: Record<string, unknown>;
}

/** Result of adapter.search() */
export interface AdapterSearchResult {
  items: AdapterSearchItem[];
  sourceUrl: string;
  structuredData?: Record<string, unknown> | null;
}

/** Result of adapter.extract() */
export interface AdapterExtractResult {
  url: string;
  title: string;
  contentText: string;
  contentState: DeepSearchRecordContentState;
  snippet: string;
  evidenceCount: number;
  screenshotPath?: string | null;
  structuredData?: Record<string, unknown> | null;
}

/** Login probe result */
export interface AdapterLoginProbe {
  siteKey: string;
  loginState: 'missing' | 'connected' | 'suspected_expired' | 'expired' | 'error';
  blockingReason: string;
  lastError: string;
}

// ---------------------------------------------------------------------------
// Account Data (browsing history, etc.)
// ---------------------------------------------------------------------------

export interface AdapterAccountDataItem {
  id: string;
  type: string;
  title: string;
  url: string;
  viewedAt: string;
  snippet?: string;
}

export interface AdapterAccountDataResult {
  dataType: string;
  items: AdapterAccountDataItem[];
  hasMore: boolean;
  total?: number;
}

// ---------------------------------------------------------------------------
// Site Adapter Interface
// ---------------------------------------------------------------------------

export interface SiteAdapter {
  readonly siteKey: string;

  /** Check if the user is logged in / cookies are valid */
  probeLogin(ctx: AdapterContext, site: { baseUrl: string; cookieValue?: string | null }): Promise<AdapterLoginProbe>;

  /** Search: given a query, return a list of result URLs + snippets */
  search(ctx: AdapterContext, query: string, maxResults: number): Promise<AdapterSearchResult>;

  /** Extract: given a specific URL, return full content */
  extract(ctx: AdapterContext, url: string): Promise<AdapterExtractResult>;

  /** Fetch personal account data (e.g. browse history). Optional — not all adapters support this. */
  fetchAccountData?(
    ctx: AdapterContext,
    dataType: string,
    options?: { limit?: number },
  ): Promise<AdapterAccountDataResult>;
}

// ---------------------------------------------------------------------------
// Legacy types (still used by generic browser adapter)
// ---------------------------------------------------------------------------

export interface DeepSearchPageExtractionResult {
  url: string;
  title: string;
  lines: string[];
  contentText: string;
  contentState: DeepSearchRecordContentState;
  snippet: string;
  evidenceCount: number;
  structuredData?: Record<string, unknown> | null;
}
