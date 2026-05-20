import { backfillFailureReason, backfillFailureSuffix } from '../jobs';

describe('backfillFailureSuffix', () => {
  it('is empty when nothing failed', () => {
    expect(backfillFailureSuffix(0, 0)).toBe('');
  });

  it('reports only the risk bucket', () => {
    const s = backfillFailureSuffix(5, 0);
    expect(s).toContain('5 条被抖音风控');
    expect(s).not.toContain('无效');
  });

  it('reports only the invalid bucket', () => {
    const s = backfillFailureSuffix(0, 3);
    expect(s).toContain('3 条无效');
    expect(s).not.toContain('风控');
  });

  it('reports both buckets distinctly', () => {
    const s = backfillFailureSuffix(4, 2);
    expect(s).toContain('4 条被抖音风控');
    expect(s).toContain('2 条无效');
  });
});

describe('backfillFailureReason', () => {
  it('all risk-controlled → recoverable guidance, no sample', () => {
    const r = backfillFailureReason(8, 0, '7xxx: 抖音 share 页被风控');
    expect(r).toContain('8 条全部被抖音风控');
    expect(r).toContain('重跑');
    expect(r).toContain('采集浏览器');
  });

  it('mixed → both counts surfaced', () => {
    const r = backfillFailureReason(3, 2);
    expect(r).toContain('3 条被风控');
    expect(r).toContain('2 条无效');
  });

  it('no risk → falls back to the sample reason', () => {
    expect(backfillFailureReason(0, 1, '7xxx: 视频已删除')).toBe('7xxx: 视频已删除');
  });

  it('no risk and no sample → generic message', () => {
    expect(backfillFailureReason(0, 0)).toBe('搜索结果均未能读取视频元数据。');
  });
});
