import { isAfterMarketClose, dayKey } from '../mesh-market-clock'

// 从某天起找最近的工作日/周六，避免硬猜某日期的星期
function weekdayAt(hour: number): Date {
  const d = new Date(2026, 5, 15, hour, 0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d
}
function weekendAt(hour: number): Date {
  const d = new Date(2026, 5, 15, hour, 0)
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1)
  return d
}

describe('mesh-market-clock（W7 收盘判断）', () => {
  it('工作日 15:00 及以后 = 收盘后', () => {
    expect(isAfterMarketClose(weekdayAt(15))).toBe(true)
    expect(isAfterMarketClose(weekdayAt(16))).toBe(true)
  })

  it('工作日盘中（<15:00）= 未收盘', () => {
    expect(isAfterMarketClose(weekdayAt(11))).toBe(false)
    expect(isAfterMarketClose(weekdayAt(14))).toBe(false)
  })

  it('周末不收盘（即便 15:00 后）', () => {
    expect(isAfterMarketClose(weekendAt(15))).toBe(false)
  })

  it('dayKey 输出 YYYY-MM-DD（补零）', () => {
    expect(dayKey(new Date(2026, 5, 5, 15, 0))).toBe('2026-06-05')
  })
})
