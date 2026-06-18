/**
 * 风控规则配置 —— 确定性硬上限，agent 只读、改不了（沿用设计：放宽风险须人工，不交给 LLM）。
 * 含基础规则 + 自动总闸（auto+live 的安全前提，paper 先做进去）。
 */
export interface RiskRules {
  // 基础
  maxOrderNotional: number // 单笔最大金额
  maxSymbolQty: number // 单票最大持仓股数
  maxTotalNotional: number // 总持仓市值上限
  blacklist: string[] // 黑名单 symbol
  noChaseLimitUp: boolean // 涨停不追
  // 自动总闸
  maxDailyLossAbs: number // 单日最大亏损绝对值（realizedPnl <= -此值 → halt）
  maxOrderCount: number // 单日最大下单笔数
  maxDailyNotional: number // 单日最大累计下单金额
}

export const DEFAULT_RISK_RULES: RiskRules = {
  maxOrderNotional: 50000,
  maxSymbolQty: 10000,
  maxTotalNotional: 200000,
  blacklist: [],
  noChaseLimitUp: true,
  maxDailyLossAbs: 20000,
  maxOrderCount: 20,
  maxDailyNotional: 300000,
}
