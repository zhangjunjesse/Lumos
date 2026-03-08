import fs from 'fs';
import path from 'path';
import * as store from '@/lib/knowledge/store';
import { parseFileForKnowledge } from '@/lib/knowledge/parsers';
import { processImport } from '@/lib/knowledge/importer';
import {
  claimNextIngestItem,
  completeIngestItemDuplicate,
  completeIngestItemFailed,
  completeIngestItemSkipped,
  completeIngestItemSuccess,
  refreshIngestJob,
  resetRunningIngestQueue,
  type ClaimedIngestItem,
} from './ingest-queue';

interface IngestWorkerState {
  started: boolean;
  running: boolean;
  bootstrapped: boolean;
  timer: NodeJS.Timeout | null;
}

const WORKER_GLOBAL_KEY = '__kbIngestWorkerState__' as const;
const TICK_INTERVAL_MS = 1500;

function getWorkerState(): IngestWorkerState {
  const globalRef = globalThis as Record<string, unknown>;
  if (!globalRef[WORKER_GLOBAL_KEY]) {
    globalRef[WORKER_GLOBAL_KEY] = {
      started: false,
      running: false,
      bootstrapped: false,
      timer: null,
    } satisfies IngestWorkerState;
  }
  return globalRef[WORKER_GLOBAL_KEY] as IngestWorkerState;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'ingest_failed';
  if (typeof error === 'string') return error;
  return 'ingest_failed';
}

function isRecoverableAccessError(errorText: string): boolean {
  const normalized = (errorText || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('cannot access file')
    || normalized.includes('enoent')
    || normalized.includes('eacces')
    || normalized.includes('eperm')
    || normalized.includes('ebusy')
    || normalized.includes('resource busy')
    || normalized.includes('timeout');
}

function parseTagList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function processClaimedItem(claim: ClaimedIngestItem): Promise<void> {
  const { collectionId, itemId, filePath, sourceKey, maxFileSize, forceReprocess } = claim;

  try {
    if (!fs.existsSync(filePath)) {
      completeIngestItemFailed(itemId, 'file_not_found');
      return;
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      completeIngestItemFailed(itemId, 'not_a_file');
      return;
    }
    if (maxFileSize > 0 && stat.size > maxFileSize) {
      completeIngestItemSkipped(itemId, 'file_too_large');
      return;
    }

    let existing = sourceKey ? store.findItemBySourceKey(collectionId, sourceKey) : undefined;
    if (!existing) {
      existing = store.findItemBySource(collectionId, 'local_file', filePath);
    }
    const recoverableExisting = existing
      ? isRecoverableAccessError(existing.processing_error || '')
      : false;
    if (existing && !forceReprocess && !recoverableExisting) {
      completeIngestItemDuplicate(itemId, existing.id);
      return;
    }

    const preservedTags = existing ? parseTagList(existing.tags || '[]') : [];
    if (existing && (forceReprocess || recoverableExisting)) {
      store.deleteItem(existing.id);
    }

    const parsed = await parseFileForKnowledge(filePath);
    if (!parsed.content.trim()) {
      completeIngestItemFailed(itemId, parsed.parseError || 'empty_content');
      return;
    }

    const title = parsed.title || existing?.title || path.basename(filePath, path.extname(filePath));
    const result = await processImport(
      collectionId,
      {
        title,
        source_type: 'local_file',
        source_path: filePath,
        source_key: sourceKey,
        tags: preservedTags,
      },
      parsed.content,
      {
        mode: parsed.mode,
        parseError: parsed.parseError,
      },
    );

    completeIngestItemSuccess(itemId, {
      itemId: result.item?.id || null,
      mode: parsed.mode,
      parseError: parsed.parseError,
    });
  } catch (error) {
    completeIngestItemFailed(itemId, normalizeErrorMessage(error));
  }
}

async function drainQueue(): Promise<void> {
  const state = getWorkerState();
  if (state.running) return;
  state.running = true;

  try {
    if (!state.bootstrapped) {
      resetRunningIngestQueue();
      state.bootstrapped = true;
    }

    while (true) {
      const claim = claimNextIngestItem();
      if (!claim) break;

      await processClaimedItem(claim);
      refreshIngestJob(claim.jobId);
    }
  } catch (error) {
    console.error('[kb/ingest-worker] drain failed:', error);
  } finally {
    state.running = false;
  }
}

export function ensureKnowledgeIngestWorker(): void {
  const state = getWorkerState();
  if (state.started) return;

  state.started = true;
  void drainQueue();

  state.timer = setInterval(() => {
    void drainQueue();
  }, TICK_INTERVAL_MS);
  if (typeof state.timer.unref === 'function') {
    state.timer.unref();
  }
}

export function triggerKnowledgeIngestNow(): void {
  ensureKnowledgeIngestWorker();
  void drainQueue();
}
