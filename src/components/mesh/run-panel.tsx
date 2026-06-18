'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const DEFAULT_SNAPSHOT = JSON.stringify(
  {
    note: '盘中快照',
    ticks: [{ code: '002156.SZ', name: '通富微电', last: 63.5, pct: 2.8, note: '封装主线、回踩5日线企稳、低吸点' }],
  },
  null,
  2,
)

interface TraceStep {
  participantId: string
  trigger: string
  thought: string
  writes: string[]
  emits: string[]
  orders: string[]
}
interface Account {
  cash: number
  positions: Record<string, { qty: number; avgPrice: number }>
  realizedPnl: number
  halted: boolean
}
interface RunResult {
  runId: string
  trace: TraceStep[]
  decision: unknown
  account: Account | null
}

/** 跑一轮 paper 协作并展示完整轨迹。 */
export function RunPanel() {
  const [snapshot, setSnapshot] = useState(DEFAULT_SNAPSHOT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      let snap: unknown
      try {
        snap = JSON.parse(snapshot)
      } catch {
        throw new Error('快照不是合法 JSON')
      }
      const res = await fetch('/api/mesh/collaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: snap }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '协作失败')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">跑一轮协作（paper）</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea value={snapshot} onChange={(e) => setSnapshot(e.target.value)} rows={5} className="font-mono text-xs" />
        <div className="flex items-center gap-2">
          <Button onClick={run} disabled={loading} size="sm">
            {loading ? '团队跑中…（约数分钟）' : '跑一轮'}
          </Button>
          {loading && <span className="text-xs text-muted-foreground">盯盘→决策→风控→成交→复盘，真 LLM 串行</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && <RunResultView result={result} />}
      </CardContent>
    </Card>
  )
}

function RunResultView({ result }: { result: RunResult }) {
  const acc = result.account
  return (
    <div className="flex flex-col gap-3 text-sm">
      {acc && (
        <div className="rounded-md border border-border p-3">
          <p className="font-medium">账户（paper）</p>
          <p className="text-muted-foreground">
            现金 {acc.cash.toFixed(2)}｜已实现盈亏 {acc.realizedPnl.toFixed(2)}｜{acc.halted ? '已熔断' : '正常'}
          </p>
          <p className="text-muted-foreground">
            持仓：
            {Object.keys(acc.positions).length
              ? Object.entries(acc.positions)
                  .map(([s, p]) => `${s} x${p.qty}@${p.avgPrice}`)
                  .join('；')
              : '无'}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {result.trace.map((t, i) => (
          <div key={i} className="rounded-md border border-border p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{roleLabel(t.participantId)}</Badge>
              <span className="text-xs text-muted-foreground">{t.trigger}</span>
              {t.emits.map((e, j) => (
                <Badge key={`e${j}`} variant="secondary">
                  发：{e}
                </Badge>
              ))}
              {t.orders.map((o, j) => (
                <Badge key={`o${j}`} variant={orderVariant(o)}>
                  {o}
                </Badge>
              ))}
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{t.thought}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function roleLabel(id: string): string {
  const m: Record<string, string> = {
    'stock.observe': '盯盘',
    'stock.decide': '决策',
    'stock.risk': '风控',
    'stock.review': '复盘',
  }
  return m[id] || id
}

function orderVariant(o: string): 'secondary' | 'destructive' | 'outline' {
  if (o.includes('rejected')) return 'destructive'
  if (o.includes('skipped')) return 'outline'
  return 'secondary'
}
