import {
  filenameFromDisposition,
  reportExecutionHref,
  reportPreview,
  safeReportName,
} from '../report-ui';

describe('wechat automation report ui helpers', () => {
  it('encodes execution record route segments', () => {
    expect(reportExecutionHref({
      scheduleId: 'schedule/with spaces',
      runId: 'run#1/中文',
    })).toBe('/workflow/schedules/schedule%2Fwith%20spaces/runs/run%231%2F%E4%B8%AD%E6%96%87');
  });

  it('keeps report previews inside the short card boundary', () => {
    expect(reportPreview('  # 标题\n正文  ')).toBe('# 标题\n正文');
    const preview = reportPreview(`标题\n${'长正文'.repeat(400)}`);
    expect(preview.length).toBeLessThanOrEqual(904);
    expect(preview.endsWith('\n...')).toBe(true);
  });

  it('parses and sanitizes report download names', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E5%BE%AE%E4%BF%A1.md")).toBe('微信.md');
    expect(filenameFromDisposition('attachment; filename="wechat.md"')).toBe('wechat.md');
    expect(safeReportName(' 每日/微信:总结?# ')).toBe('每日-微信-总结');
    expect(safeReportName('   ')).toBe('wechat-report');
  });
});
