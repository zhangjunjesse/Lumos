import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { getEcommerceStore } from './storage';
import type { ResearchReportRecord, ResearchReportStatus } from './types';

export const RESEARCH_REPORTS_COLLECTION = 'research_reports';

export type ResearchReportRow = AppRow<ResearchReportRecord>;

export function getResearchReportsDir(): string {
  const base = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  const dir = path.join(base, '.lumos-uploads', 'ecommerce-assistant', 'research-reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function reportFilePathForId(id: string): string {
  return path.join(getResearchReportsDir(), `${id}.md`);
}

export function reportRelativePathForId(id: string): string {
  return path.join('ecommerce-assistant', 'research-reports', `${id}.md`);
}

export interface CreateResearchReportArgs {
  platform: string;
  query: string;
  instruction?: string | null;
  sources?: string[];
}

export function createResearchReport(
  store: AppDataStore,
  args: CreateResearchReportArgs,
): ResearchReportRow {
  const sources = args.sources && args.sources.length > 0 ? args.sources : ['web'];
  const now = new Date().toISOString();
  return store.create<ResearchReportRecord>(RESEARCH_REPORTS_COLLECTION, {
    platform: args.platform,
    query: args.query,
    instruction: args.instruction ?? null,
    status: 'queued',
    stage: null,
    progress: 0,
    sources: JSON.stringify(sources),
    source_results: null,
    summary: null,
    report_path: null,
    word_count: null,
    error: null,
    failure_stage: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  });
}

export function getResearchReport(
  store: AppDataStore,
  id: string,
): ResearchReportRow | null {
  return store.get<ResearchReportRecord>(RESEARCH_REPORTS_COLLECTION, id);
}

export interface ListResearchReportsFilter {
  status?: ResearchReportStatus;
  platform?: string;
  limit?: number;
}

export function listResearchReports(
  store: AppDataStore,
  filter: ListResearchReportsFilter = {},
): ResearchReportRow[] {
  const restrict: Partial<ResearchReportRecord> = {};
  if (filter.status) restrict.status = filter.status;
  if (filter.platform) restrict.platform = filter.platform;
  return store.query<ResearchReportRecord>(RESEARCH_REPORTS_COLLECTION, {
    filter: Object.keys(restrict).length > 0 ? (restrict as Record<string, unknown>) : undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: filter.limit ?? 100,
  });
}

export function patchResearchReport(
  store: AppDataStore,
  id: string,
  patch: Partial<ResearchReportRecord>,
): ResearchReportRow | null {
  return store.update<ResearchReportRecord>(RESEARCH_REPORTS_COLLECTION, id, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

export function deleteResearchReport(
  store: AppDataStore,
  id: string,
  opts: { removeFile?: boolean } = {},
): boolean {
  const row = getResearchReport(store, id);
  const deleted = store.delete(RESEARCH_REPORTS_COLLECTION, id);
  if (deleted && opts.removeFile !== false && row?.report_path) {
    const file = reportFilePathForId(id);
    try {
      fs.unlinkSync(file);
    } catch {
      // best effort; ignore missing-file errors
    }
  }
  return deleted;
}

export function writeReportMarkdown(id: string, markdown: string): { absolutePath: string; relativePath: string; wordCount: number } {
  const absolutePath = reportFilePathForId(id);
  fs.writeFileSync(absolutePath, markdown, 'utf8');
  return {
    absolutePath,
    relativePath: reportRelativePathForId(id),
    wordCount: countWords(markdown),
  };
}

export function readReportMarkdown(id: string): string | null {
  const absolutePath = reportFilePathForId(id);
  if (!fs.existsSync(absolutePath)) return null;
  return fs.readFileSync(absolutePath, 'utf8');
}

function countWords(text: string): number {
  // Count Chinese characters + ASCII words. Good enough for a "report size" badge.
  const chinese = text.match(/[一-鿿]/g)?.length ?? 0;
  const asciiWords = text.match(/[A-Za-z]+/g)?.length ?? 0;
  return chinese + asciiWords;
}

// Convenience wrapper for callers that just want the default ecommerce store.
export function getResearchStore(): AppDataStore {
  return getEcommerceStore();
}
