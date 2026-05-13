import { clusterReportsByBatch, parsePlatformInput } from '../research-batch';
import type { ResearchReport } from '../types';

function r(overrides: Partial<ResearchReport>): ResearchReport {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2, 10),
    platform: overrides.platform ?? 'etsy',
    query: overrides.query ?? 'q',
    instruction: overrides.instruction ?? null,
    status: overrides.status ?? 'completed',
    stage: null,
    progress: 100,
    sources: [],
    source_results: null,
    summary: null,
    report_path: null,
    word_count: null,
    error: null,
    failure_stage: null,
    created_at: overrides.created_at ?? '2026-05-13T12:00:00Z',
    started_at: null,
    completed_at: null,
    updated_at: null,
  };
}

describe('parsePlatformInput', () => {
  it('splits a comma+space input into trimmed lowercase tokens', () => {
    expect(parsePlatformInput('etsy, AMAZON  walmart')).toEqual(['etsy', 'amazon', 'walmart']);
  });

  it('accepts Chinese commas and semicolons too', () => {
    expect(parsePlatformInput('etsy，amazon；walmart')).toEqual(['etsy', 'amazon', 'walmart']);
  });

  it('returns an empty list for empty / whitespace input', () => {
    expect(parsePlatformInput('')).toEqual([]);
    expect(parsePlatformInput('   ')).toEqual([]);
  });

  it('deduplicates repeated platforms', () => {
    expect(parsePlatformInput('etsy etsy etsy amazon')).toEqual(['etsy', 'amazon']);
  });

  it('caps the result at the max (default 6)', () => {
    const input = 'a b c d e f g h i j';
    expect(parsePlatformInput(input)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('honors a custom max', () => {
    expect(parsePlatformInput('a b c d', 2)).toEqual(['a', 'b']);
  });
});

describe('clusterReportsByBatch', () => {
  it('groups same-query reports created within 5 minutes', () => {
    const reports = [
      r({ id: '1', query: '陶瓷杯', platform: 'etsy', created_at: '2026-05-13T12:00:00Z' }),
      r({ id: '2', query: '陶瓷杯', platform: 'amazon', created_at: '2026-05-13T12:00:01Z' }),
      r({ id: '3', query: '陶瓷杯', platform: 'walmart', created_at: '2026-05-13T12:00:02Z' }),
    ];
    const batches = clusterReportsByBatch(reports);
    expect(batches).toHaveLength(1);
    expect(batches[0].reports.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('keeps reports as separate batches when their created_at is more than 5 minutes apart', () => {
    const reports = [
      r({ id: '1', query: '陶瓷杯', platform: 'etsy', created_at: '2026-05-13T12:00:00Z' }),
      r({ id: '2', query: '陶瓷杯', platform: 'amazon', created_at: '2026-05-13T12:10:00Z' }),
    ];
    const batches = clusterReportsByBatch(reports);
    expect(batches).toHaveLength(2);
  });

  it('keeps different-query reports in separate batches even if simultaneous', () => {
    const reports = [
      r({ id: '1', query: '陶瓷杯', platform: 'etsy', created_at: '2026-05-13T12:00:00Z' }),
      r({ id: '2', query: '保温杯', platform: 'amazon', created_at: '2026-05-13T12:00:01Z' }),
    ];
    const batches = clusterReportsByBatch(reports);
    expect(batches).toHaveLength(2);
  });

  it('emits batches with size>1 only when there are multiple matching reports', () => {
    const reports = [
      r({ id: '1', query: 'unique', created_at: '2026-05-13T12:00:00Z' }),
    ];
    const batches = clusterReportsByBatch(reports);
    expect(batches).toHaveLength(1);
    expect(batches[0].reports).toHaveLength(1);
  });
});
