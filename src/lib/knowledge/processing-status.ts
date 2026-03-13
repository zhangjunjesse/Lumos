import type { KbProcessingStatus, KbStageStatus } from './types';

export interface ProcessingDetail {
  mode: 'full' | 'reference';
  parse: KbStageStatus;
  chunk: KbStageStatus;
  bm25: KbStageStatus;
  embedding: KbStageStatus;
  summary: KbStageStatus;
}

export function detailToJson(detail: ProcessingDetail): string {
  return JSON.stringify(detail);
}

export function createDetail(
  mode: 'full' | 'reference',
  parseStatus: KbStageStatus,
): ProcessingDetail {
  const isReference = mode === 'reference';
  return {
    mode,
    parse: parseStatus,
    chunk: 'pending',
    bm25: 'pending',
    embedding: isReference ? 'skipped' : 'pending',
    summary: isReference ? 'skipped' : 'pending',
  };
}

export function stageFailed(detail: ProcessingDetail): boolean {
  return [detail.parse, detail.chunk, detail.bm25, detail.embedding, detail.summary].includes('failed');
}

export function resolveStatus(detail: ProcessingDetail, hasError: boolean): KbProcessingStatus {
  if (detail.mode === 'reference') {
    if (detail.chunk === 'failed' || detail.bm25 === 'failed') return 'partial';
    return 'reference_only';
  }

  const hardFailed = detail.parse === 'failed' || detail.chunk === 'failed';
  if (hardFailed) return 'failed';

  if (detail.summary === 'running') return 'summarizing';
  if (detail.embedding === 'running') return 'embedding';
  if (detail.bm25 === 'running') return 'indexing';
  if (detail.chunk === 'running') return 'chunking';
  if (detail.parse === 'running') return 'parsing';

  const stageValues = [detail.parse, detail.chunk, detail.bm25, detail.embedding, detail.summary];
  if (stageValues.every((value) => value === 'done' || value === 'skipped')) return 'ready';
  if (detail.bm25 === 'failed' || detail.embedding === 'failed') return 'partial';
  if (detail.summary === 'failed') return 'ready';
  if (hasError) return 'partial';
  return 'pending';
}
