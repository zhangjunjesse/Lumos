/**
 * 风控规则存储 —— 单例（default）。设置页保存的数值规则落这里，协作据此做确定性风控。
 * 缺省回落 DEFAULT_RISK_RULES。agent 只读、改不了（放宽风险须人工，经设置页确定性写入）。
 */
import { getDb } from '@/lib/db/connection'
import { DEFAULT_RISK_RULES, type RiskRules } from './mesh-risk-rules'

const DEFAULT_ID = 'default'

interface Row {
  max_order_notional: number
  max_symbol_qty: number
  max_total_notional: number
  blacklist_json: string
  no_chase_limit_up: number
  max_daily_loss_abs: number
  max_order_count: number
  max_daily_notional: number
}

export function getRiskRules(): RiskRules {
  const row = getDb().prepare('SELECT * FROM mesh_risk_rules WHERE id = ?').get(DEFAULT_ID) as Row | undefined
  if (!row) return { ...DEFAULT_RISK_RULES }
  return {
    maxOrderNotional: row.max_order_notional,
    maxSymbolQty: row.max_symbol_qty,
    maxTotalNotional: row.max_total_notional,
    blacklist: safeArr(row.blacklist_json),
    noChaseLimitUp: row.no_chase_limit_up !== 0,
    maxDailyLossAbs: row.max_daily_loss_abs,
    maxOrderCount: row.max_order_count,
    maxDailyNotional: row.max_daily_notional,
  }
}

export function upsertRiskRules(patch: Partial<RiskRules>): RiskRules {
  const next: RiskRules = { ...getRiskRules(), ...patch }
  getDb()
    .prepare(
      `INSERT INTO mesh_risk_rules
         (id, max_order_notional, max_symbol_qty, max_total_notional, blacklist_json,
          no_chase_limit_up, max_daily_loss_abs, max_order_count, max_daily_notional, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         max_order_notional=excluded.max_order_notional, max_symbol_qty=excluded.max_symbol_qty,
         max_total_notional=excluded.max_total_notional, blacklist_json=excluded.blacklist_json,
         no_chase_limit_up=excluded.no_chase_limit_up, max_daily_loss_abs=excluded.max_daily_loss_abs,
         max_order_count=excluded.max_order_count, max_daily_notional=excluded.max_daily_notional,
         updated_at=datetime('now')`,
    )
    .run(
      DEFAULT_ID,
      next.maxOrderNotional,
      next.maxSymbolQty,
      next.maxTotalNotional,
      JSON.stringify(next.blacklist),
      next.noChaseLimitUp ? 1 : 0,
      next.maxDailyLossAbs,
      next.maxOrderCount,
      next.maxDailyNotional,
    )
  return next
}

function safeArr(json: string): string[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}
