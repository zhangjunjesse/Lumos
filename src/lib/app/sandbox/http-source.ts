// HTTP-based AppSourceProvider — runs in Electron's main process and fetches
// builder artifacts from the local Next.js server.
//
// Why HTTP and not direct SQLite: better-sqlite3 is loaded inside the Next.js
// utility process; the main process has no direct DB binding. Going through
// HTTP keeps the main process pure (only fetch + esbuild).

import * as http from 'node:http';

import type { AppFile } from '@/lib/app/compile/types';
import type { AppSourceProvider } from './app-loader';
import { parseBuilderAppId } from './app-loader';

export interface HttpSourceProviderOptions {
  /** Returns the current Next.js server origin (e.g. http://127.0.0.1:43127). */
  getServerOrigin: () => string | null;
  /** Optional fetch-like function for tests. */
  fetcher?: (url: string) => Promise<{ status: number; body: string }>;
}

interface ArtifactRow {
  filePath: string;
  content: string;
}

interface ArtifactsResponse {
  artifacts: ArtifactRow[];
  error?: string;
}

export class HttpBuilderSourceProvider implements AppSourceProvider {
  constructor(private opts: HttpSourceProviderOptions) {}

  async loadSources(appId: string): Promise<AppFile[] | null> {
    const sessionId = parseBuilderAppId(appId);
    if (!sessionId) return null;

    const origin = this.opts.getServerOrigin();
    if (!origin) {
      throw new Error('local server not ready; cannot load app sources');
    }

    const url = `${origin}/api/apps/builder/sessions/${encodeURIComponent(sessionId)}/artifacts`;
    const fetcher = this.opts.fetcher ?? defaultFetcher;
    const res = await fetcher(url);
    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new Error(`fetch ${url} failed with status ${res.status}: ${res.body.slice(0, 200)}`);
    }
    let parsed: ArtifactsResponse;
    try {
      parsed = JSON.parse(res.body) as ArtifactsResponse;
    } catch (err) {
      throw new Error(`invalid JSON from ${url}: ${(err as Error).message}`);
    }
    if (parsed.error) throw new Error(`server error from ${url}: ${parsed.error}`);
    if (!Array.isArray(parsed.artifacts) || parsed.artifacts.length === 0) return null;
    return parsed.artifacts.map((a) => ({ path: a.filePath, content: a.content }));
  }
}

function defaultFetcher(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`http get timeout: ${url}`));
    });
  });
}
