/**
 * Adapter-based DeepSearch execution engine.
 *
 * Replaces the old browser-binding loop with a strategy-agnostic flow:
 *   adapter.search(query) → adapter.extract(url) per follow-up
 * Each adapter decides internally whether to use HTTP API or browser.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  dataDir,
  listDeepSearchSites,
  updateDeepSearchRunExecution,
  appendDeepSearchRunResult,
} from '@/lib/db';
import type { BrowserBridgeRuntimeConfig } from '@/lib/browser-runtime/bridge-client';
import type { DeepSearchRunRecord } from '@/types';
import { createAdapterContext } from './adapter-context';
import { getAdapter } from './adapter-registry';
import type { AdapterExtractResult } from './adapter-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeSegment(value: string, fallback: string): string {
  const s = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || fallback;
}

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0]!;
}

function buildStructuredJson(entry: { siteKey: string | null; url: string; title: string; structuredData?: Record<string, unknown> | null }): string {
  return JSON.stringify({ siteKey: entry.siteKey, url: entry.url, title: entry.title, structuredData: entry.structuredData ?? null }, null, 2);
}

// ---------------------------------------------------------------------------
// Persist a single extraction result to disk + DB
// ---------------------------------------------------------------------------

async function persistResult(
  runId: string,
  artifactDir: string,
  siteKey: string | null,
  result: AdapterExtractResult,
): Promise<void> {
  const ts = nowTimestamp();
  const recordId = crypto.randomUUID();
  const seg = sanitizeSegment(siteKey || 'page', 'page');
  const urlSeg = sanitizeSegment(new URL(result.url).hostname, 'url');

  const artifacts: Array<{
    id: string; recordId: string | null; kind: 'content' | 'screenshot' | 'structured_json';
    title: string; storagePath: string; mimeType: string; sizeBytes: number;
    metadata: Record<string, unknown> | null; createdAt: string;
  }> = [];
  let contentArtifactId: string | null = null;
  let screenshotArtifactId: string | null = null;

  // Content artifact
  if (result.contentText.trim()) {
    const contentPath = path.join(artifactDir, `${seg}-${urlSeg}-${recordId.slice(0, 8)}-content.txt`);
    await fs.writeFile(contentPath, result.contentText, 'utf-8');
    const stat = await fs.stat(contentPath);
    contentArtifactId = crypto.randomUUID();
    artifacts.push({
      id: contentArtifactId, recordId, kind: 'content',
      title: `${result.title || result.url} content`,
      storagePath: contentPath, mimeType: 'text/plain; charset=utf-8',
      sizeBytes: stat.size, metadata: { siteKey, url: result.url, title: result.title }, createdAt: ts,
    });
  }

  // Structured JSON artifact
  const jsonPath = path.join(artifactDir, `${seg}-${urlSeg}-${recordId.slice(0, 8)}-snapshot.json`);
  const jsonContent = buildStructuredJson({ siteKey, url: result.url, title: result.title, structuredData: result.structuredData });
  await fs.writeFile(jsonPath, jsonContent, 'utf-8');
  const jsonStat = await fs.stat(jsonPath);
  artifacts.push({
    id: crypto.randomUUID(), recordId, kind: 'structured_json',
    title: `${result.title || result.url} snapshot`,
    storagePath: jsonPath, mimeType: 'application/json',
    sizeBytes: jsonStat.size, metadata: { siteKey, url: result.url }, createdAt: ts,
  });

  // Screenshot artifact (if adapter provided one)
  if (result.screenshotPath) {
    try {
      const ssStat = await fs.stat(result.screenshotPath);
      screenshotArtifactId = crypto.randomUUID();
      artifacts.push({
        id: screenshotArtifactId, recordId, kind: 'screenshot',
        title: `${result.title || result.url} screenshot`,
        storagePath: result.screenshotPath, mimeType: 'image/png',
        sizeBytes: ssStat.size, metadata: { siteKey, url: result.url }, createdAt: ts,
      });
    } catch { /* missing screenshot, skip */ }
  }

  appendDeepSearchRunResult({
    runId,
    record: {
      id: recordId, runPageId: null, siteKey, url: result.url, title: result.title,
      contentState: result.contentState, snippet: result.snippet.slice(0, 600),
      evidenceCount: result.evidenceCount, contentArtifactId, screenshotArtifactId,
      errorMessage: '', fetchedAt: ts,
    },
    artifacts,
  });
}

function persistFailure(runId: string, siteKey: string | null, url: string, error: string): void {
  appendDeepSearchRunResult({
    runId,
    record: {
      id: crypto.randomUUID(), runPageId: null, siteKey, url, title: '',
      contentState: 'failed', snippet: '', evidenceCount: 0,
      failureStage: 'extraction', loginRelated: false,
      errorMessage: error, fetchedAt: nowTimestamp(),
    },
    artifacts: [],
  });
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

export interface ExecutionParams {
  run: DeepSearchRunRecord;
  config: BrowserBridgeRuntimeConfig;
  eligibleSiteKeys: string[];
  blockedSiteKeys: string[];
  startedAt: string;
}

export async function executeAdapterRun(params: ExecutionParams): Promise<DeepSearchRunRecord> {
  const { run, config, eligibleSiteKeys, startedAt } = params;
  const ctx = createAdapterContext(config);
  const artifactDir = path.join(dataDir, 'deepsearch-artifacts', run.id);
  await fs.rm(artifactDir, { recursive: true, force: true });
  await fs.mkdir(artifactDir, { recursive: true });

  const siteMinFetchMap = new Map(
    listDeepSearchSites()
      .filter((s) => run.siteKeys.includes(s.siteKey))
      .map((s) => [s.siteKey, s.minFetchCount]),
  );

  let successCount = 0;
  let failureCount = 0;
  const coveredSiteKeys = new Set<string>();

  for (const siteKey of eligibleSiteKeys) {
    const adapter = getAdapter(siteKey);
    const maxResults = siteMinFetchMap.get(siteKey) ?? 3;

    // --- Search phase ---
    await updateDeepSearchRunExecution({
      id: run.id, status: 'running', startedAt,
      statusMessage: `${siteKey} — 正在搜索…`,
      resultSummary: successCount > 0 ? `${successCount} 篇已抓取` : '搜索中…',
    });

    let searchResult;
    try {
      searchResult = await adapter.search(ctx, run.queryText, maxResults);
    } catch (error) {
      persistFailure(run.id, siteKey, '', error instanceof Error ? error.message : String(error));
      failureCount += 1;
      continue;
    }

    if (searchResult.items.length === 0) {
      persistFailure(run.id, siteKey, searchResult.sourceUrl, '搜索无结果');
      failureCount += 1;
      continue;
    }

    // Persist search result as list_only record
    await persistResult(run.id, artifactDir, siteKey, {
      url: searchResult.sourceUrl,
      title: `${siteKey} 搜索结果`,
      contentText: searchResult.items.map((item, i) =>
        `${i + 1}. ${item.title}${item.voteCount ? ` [${item.voteCount} 赞]` : ''}\n${item.url}\n${item.snippet}`).join('\n\n'),
      contentState: 'list_only',
      snippet: searchResult.items[0]?.snippet || '',
      evidenceCount: searchResult.items.length,
      structuredData: searchResult.structuredData,
    });
    successCount += 1;

    // --- Detail extraction phase (parallel) ---
    const detailUrls = searchResult.items.slice(0, maxResults).map((item) => item.url).filter(Boolean);
    const seen = new Set<string>();
    const uniqueUrls = detailUrls.filter((url) => {
      const normalized = url.replace(/\/$/, '');
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    await updateDeepSearchRunExecution({
      id: run.id, status: 'running', startedAt,
      statusMessage: `${siteKey} — 正在并行抓取 ${uniqueUrls.length} 篇详情…`,
      resultSummary: `${successCount} 篇已抓取`,
    });

    const extractionPromises = uniqueUrls.map(async (url, i) => {
      try {
        const result = await adapter.extract(ctx, url);
        await persistResult(run.id, artifactDir, siteKey, result);
        successCount += 1;
        coveredSiteKeys.add(siteKey);
        // Update progress after each completion
        await updateDeepSearchRunExecution({
          id: run.id, status: 'running', startedAt,
          statusMessage: `${siteKey} — 已完成 ${i + 1}/${uniqueUrls.length}`,
          resultSummary: `${successCount} 篇已抓取`,
        });
      } catch (error) {
        persistFailure(run.id, siteKey, url, error instanceof Error ? error.message : String(error));
        failureCount += 1;
      }
    });

    await Promise.all(extractionPromises);
    if (coveredSiteKeys.has(siteKey) || successCount > 0) {
      coveredSiteKeys.add(siteKey);
    }
  }

  // --- Final status ---
  const uncoveredSiteKeys = eligibleSiteKeys.filter((k) => !coveredSiteKeys.has(k));
  let finalStatus: DeepSearchRunRecord['status'] = 'completed';
  if (successCount === 0) finalStatus = 'failed';
  else if (uncoveredSiteKeys.length > 0 || failureCount > 0 || params.blockedSiteKeys.length > 0) finalStatus = 'partial';

  const completedAt = nowTimestamp();
  const msg = finalStatus === 'completed'
    ? `已完成，共抓取 ${successCount} 篇内容。`
    : finalStatus === 'partial'
      ? `部分完成：${successCount} 篇成功，${failureCount} 篇失败。`
      : '抓取失败，未获取到有效内容。';

  return updateDeepSearchRunExecution({
    id: run.id, status: finalStatus,
    statusMessage: msg,
    resultSummary: `${successCount} 篇已抓取`,
    startedAt, completedAt,
    releaseBindings: true,
  });
}
