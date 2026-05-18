import {
  buildRecurringPatch,
  isSupportedRecurringCron,
  parseRecurringScheduleConfig,
} from '../automation-schedule-form';

describe('automation schedule form (UI 能选 == 引擎能跑)', () => {
  it('parse ↔ build round-trips the four engine-runnable shapes', () => {
    for (const cron of ['0 9 * * *', '30 18 * * 5', '0 */4 * * *', '*/15 * * * *']) {
      expect(buildRecurringPatch(parseRecurringScheduleConfig(cron)).cron).toBe(cron);
      expect(isSupportedRecurringCron(cron)).toBe(true);
    }
  });

  it('classifies cron shapes the scheduler cannot run as unsupported', () => {
    // 每月 / 工作日范围 / 列表 —— 引擎不支持，旧自由 cron 时代会静默失效。
    for (const cron of ['0 9 1 * *', '0 9 * * 1-5', '30 9,18 * * *', 'not-a-cron']) {
      expect(isSupportedRecurringCron(cron)).toBe(false);
    }
  });

  it('maps the new 每 N 分钟 mode to an engine minute-step cron', () => {
    expect(buildRecurringPatch({
      mode: 'minutely', time: '09:00', weekday: '1', intervalHours: 4, intervalMinutes: 15,
    })).toEqual(expect.objectContaining({ cron: '*/15 * * * *', cronLabel: '每 15 分钟' }));
  });

  it('falls back to daily (never custom) for unrecognized cron', () => {
    expect(parseRecurringScheduleConfig('0 9 1 * *').mode).toBe('daily');
  });
});
