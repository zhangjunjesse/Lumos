import { parseCronToSchedule } from '../cron-utils';

describe('parseCronToSchedule', () => {
  test('每周一 09:00', () => {
    const r = parseCronToSchedule('0 9 * * 1');
    expect(r.intervalMinutes).toBe(10080);
    expect(r.scheduleTime).toBe('09:00');
    expect(r.scheduleDayOfWeek).toBe(1);
  });

  test('每周日 22:30', () => {
    const r = parseCronToSchedule('30 22 * * 0');
    expect(r.intervalMinutes).toBe(10080);
    expect(r.scheduleTime).toBe('22:30');
    expect(r.scheduleDayOfWeek).toBe(0);
  });

  test('每天 09:00', () => {
    const r = parseCronToSchedule('0 9 * * *');
    expect(r.intervalMinutes).toBe(1440);
    expect(r.scheduleTime).toBe('09:00');
    expect(r.scheduleDayOfWeek).toBeNull();
  });

  test('每月 15 号 12:00', () => {
    const r = parseCronToSchedule('0 12 15 * *');
    expect(r.intervalMinutes).toBe(43200);
    expect(r.scheduleTime).toBe('12:00');
    expect(r.scheduleDayOfWeek).toBeNull();
  });

  test('每 30 分钟跑一次 (步长 cron)', () => {
    const r = parseCronToSchedule('*/30 * * * *');
    expect(r.intervalMinutes).toBe(30);
    expect(r.scheduleTime).toBeNull();
    expect(r.scheduleDayOfWeek).toBeNull();
  });

  test('非法 cron 退化到默认 (每周一 09:00)', () => {
    const r = parseCronToSchedule('garbage');
    expect(r.intervalMinutes).toBe(10080);
    expect(r.scheduleDayOfWeek).toBe(1);
    expect(r.scheduleTime).toBe('09:00');
  });

  test('6 段 cron 自动剥离秒位', () => {
    const r = parseCronToSchedule('0 0 9 * * 1');
    expect(r.intervalMinutes).toBe(10080);
    expect(r.scheduleDayOfWeek).toBe(1);
    expect(r.scheduleTime).toBe('09:00');
  });

  test('小时 0 → 00:00 padding 正确', () => {
    const r = parseCronToSchedule('5 0 * * 3');
    expect(r.scheduleTime).toBe('00:05');
    expect(r.scheduleDayOfWeek).toBe(3);
  });
});
