'use client'

import type { ReactNode } from 'react'
import type { PaperAccountLike } from './war-room'

// 默认风控上限（与后端 DEFAULT_RISK_RULES 对齐，用于总闸进度展示）
const RULES = { maxDailyLossAbs: 20000, maxOrderCount: 20, maxDailyNotional: 300000 }

const yuan = (n: number) => '¥' + Math.round(n).toLocaleString('zh-CN')
const pnlColor = (v: number) => (v > 0 ? 'text-red-600' : v < 0 ? 'text-emerald-600' : 'text-neutral-500')

export function DataPanels({ account }: { account: PaperAccountLike | null }) {
  if (!account) {
    return <div className="p-8 text-center text-sm text-neutral-400">还没有账户 —— 启动团队后这里显示资金 / 持仓 / 风控</div>
  }

  const positions = Object.entries(account.positions)
  const marketValue = positions.reduce((s, [, p]) => s + p.qty * p.avgPrice, 0)

  return (
    <div className="space-y-4 p-4">
      <Panel title="账户概览" extra={account.halted ? '已 halt' : `今日 ${account.orderCount} 笔`}>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="可用现金" value={yuan(account.cash)} />
          <Stat label="持仓市值（按成本）" value={yuan(marketValue)} />
          <Stat label="已实现盈亏" value={yuan(account.realizedPnl)} color={pnlColor(account.realizedPnl)} />
          <Stat label="累计手续费" value={yuan(account.feesPaid)} />
        </div>
      </Panel>

      <Panel title="风控总闸" extra={account.halted ? '已 halt' : '正常'}>
        <div className="space-y-3">
          <Bar label="今日亏损" cur={Math.max(0, -account.realizedPnl)} max={RULES.maxDailyLossAbs} />
          <Bar label="下单笔数" cur={account.orderCount} max={RULES.maxOrderCount} />
          <Bar label="下单金额" cur={account.notionalTraded} max={RULES.maxDailyNotional} />
        </div>
      </Panel>

      <Panel title="当前持仓" extra={`${positions.length} 只`}>
        {positions.length === 0 ? (
          <p className="text-sm text-neutral-400">暂无持仓</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400">
                <th className="pb-2 font-normal">标的</th>
                <th className="pb-2 text-right font-normal">持仓</th>
                <th className="pb-2 text-right font-normal">成本</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(([sym, p]) => (
                <tr key={sym} className="border-t border-neutral-100">
                  <td className="py-2 text-neutral-900">{sym}</td>
                  <td className="py-2 text-right text-neutral-700">{p.qty}</td>
                  <td className="py-2 text-right text-neutral-700">{p.avgPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${color ?? 'text-neutral-900'}`}>{value}</div>
    </div>
  )
}

function Bar({ label, cur, max }: { label: string; cur: number; max: number }) {
  const pct = Math.min(100, Math.round((cur / max) * 100))
  const bar = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-neutral-500">{label}</span>
        <span className="text-neutral-700">
          {Math.round(cur).toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Panel({ title, extra, children }: { title: string; extra?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-900">{title}</h3>
        {extra && <span className="text-xs text-neutral-400">{extra}</span>}
      </div>
      {children}
    </section>
  )
}
