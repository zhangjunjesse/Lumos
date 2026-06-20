/**
 * A 股交易时段判断 —— 纯函数（可测、不依赖 db）。收盘 = 工作日 15:00 后。
 * 用本地时区（Electron 跑在用户机器，A 股按北京时间）。配合 scheduler 当日去重，只 emit 一次 market_close。
 */
export function isAfterMarketClose(now: Date): boolean {
  const day = now.getDay()
  if (day === 0 || day === 6) return false // 周末不收盘
  return now.getHours() >= 15 // 15:00 及以后
}

/** 当日标识 YYYY-MM-DD（per-runner 当日去重用）。 */
export function dayKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
