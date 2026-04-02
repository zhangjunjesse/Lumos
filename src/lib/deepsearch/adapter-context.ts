import {
  type BrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
  postToBrowserBridge,
} from '@/lib/browser-runtime/bridge-client';
import type { AdapterContext, AdapterFetchResponse, AdapterBrowserCaptureResult } from './adapter-types';

// ---------------------------------------------------------------------------
// Bridge response types
// ---------------------------------------------------------------------------

interface BridgeFetchResponse extends BrowserBridgeResponse {
  url: string;
  status: number;
  contentType: string;
  htmlLength: number;
  truncated: boolean;
  html: string;
}

interface BridgePageMutationResponse extends BrowserBridgeResponse {
  pageId: string;
}

interface BridgePageSnapshotResponse extends BrowserBridgeResponse {
  pageId: string;
  url?: string;
  title?: string;
  lines?: string[];
}

interface BridgePageEvaluateResponse extends BrowserBridgeResponse {
  pageId: string;
  value?: unknown;
}

interface BridgePageScreenshotResponse extends BrowserBridgeResponse {
  pageId: string;
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAdapterContext(config: BrowserBridgeRuntimeConfig): AdapterContext {
  return {
    async fetch(url: string, options?: { headers?: Record<string, string> }): Promise<AdapterFetchResponse> {
      const result = await postToBrowserBridge<BridgeFetchResponse>(config, '/v1/fetch', {
        url,
        headers: options?.headers,
      });
      return {
        status: result.status,
        html: result.html,
        contentType: result.contentType,
      };
    },

    async browserCapture(url: string, options?: {
      script?: string;
      screenshotPath?: string;
    }): Promise<AdapterBrowserCaptureResult> {
      const page = await postToBrowserBridge<BridgePageMutationResponse>(config, '/v1/pages/new', {
        url,
        background: true,
      });
      const pageId = page.pageId;

      try {
        const snapshot = await postToBrowserBridge<BridgePageSnapshotResponse>(config, '/v1/pages/snapshot', {
          pageId,
          background: true,
        });

        let value: unknown = null;
        if (options?.script) {
          const evalResult = await postToBrowserBridge<BridgePageEvaluateResponse>(config, '/v1/pages/evaluate', {
            pageId,
            expression: options.script,
            background: true,
          });
          value = evalResult.value;
        }

        let screenshotPath: string | null = null;
        if (options?.screenshotPath) {
          try {
            const shot = await postToBrowserBridge<BridgePageScreenshotResponse>(config, '/v1/pages/screenshot', {
              pageId,
              filePath: options.screenshotPath,
              background: true,
            });
            screenshotPath = shot.filePath || options.screenshotPath;
          } catch {
            screenshotPath = null;
          }
        }

        return {
          url: snapshot.url || url,
          title: snapshot.title || '',
          value,
          screenshotPath,
        };
      } finally {
        try {
          await postToBrowserBridge<{ ok: true }>(config, '/v1/pages/close', { pageId });
        } catch {
          // Best-effort cleanup
        }
      }
    },
  };
}
