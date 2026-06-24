'use client'

import { useState, useEffect, useCallback } from 'react'
import { Play, Pause, Square, Settings, Clock } from 'lucide-react'
import { AgentChat } from './agent-chat'
import { Blackboard } from './blackboard'
import { DataPanels } from './data-panels'

export interface Workshop {
  id: string
  name: string
  description: string
  status: 'active' | 'paused' | 'draft'
}

export interface BBEntry {
  key: string
  value: unknown
  version: number
  writtenBy: string
  writtenAt: string
}
export interface MsgRecord {
  id: string
  topic: string
  payload: unknown
  from: string
  createdAt: string
}
export interface PaperAccountLike {
  cash: number
  positions: Record<string, { qty: number; avgPrice: number }>
  realizedPnl: number
  feesPaid: number
  orderCount: number
  notionalTraded: number
  halted: boolean
}
interface Snapshot {
  active: boolean
  rounds: number
  tradeMode?: 'paper' | 'live'
  account: PaperAccountLike | null
  blackboard: BBEntry[]
  messages: MsgRecord[]
}

export function WarRoom({ workshop, onBack, onSettings }: { workshop: Workshop; onBack: () => void; onSettings: () => void }) {
  const [leftTab, setLeftTab] = useState('board')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const accountId = workshop.id // 工作室 id 即账户/会话维度（多工作室隔离）

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/mesh/warroom?accountId=${accountId}`)
      if (r.ok) setSnap(await r.json())
    } catch {
      /* 轮询失败忽略，下次再试 */
    }
  }, [accountId])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const control = async (action: 'start' | 'stop') => {
    setBusy(true)
    try {
      await fetch('/api/mesh/runner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, accountId }),
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const active = snap?.active ?? false

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-neutral-500 hover:text-neutral-900">
          ← 返回
        </button>
        <h1 className="text-lg font-semibold text-neutral-900">{workshop.name} · 作战室</h1>
        <span
          className={`rounded-md px-2 py-0.5 text-xs ring-1 ${
            active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-neutral-100 text-neutral-600 ring-neutral-200'
          }`}
        >
          {active ? `运行中 · ${snap?.rounds ?? 0} 次执行` : '已停止'}
        </span>
        {snap?.tradeMode === 'live' ? (
          <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-300">● 真盘 · 真实下单</span>
        ) : (
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 ring-1 ring-neutral-200">模拟盘</span>
        )}
        <LiveClock />
        <Controls active={active} busy={busy} onStart={() => control('start')} onStop={() => control('stop')} onSettings={onSettings} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-center gap-1 border-b border-neutral-200 px-2">
            {[
              { key: 'board', label: '共享黑板' },
              { key: 'data', label: '数据面板' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setLeftTab(t.key)}
                className={`relative px-3 py-2.5 text-sm transition-colors ${
                  leftTab === t.key ? 'font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {t.label}
                {leftTab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-900" />}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'board' ? <Blackboard entries={snap?.blackboard ?? []} /> : <DataPanels account={snap?.account ?? null} />}
          </div>
        </div>

        <AgentChat accountId={accountId} messages={snap?.messages ?? []} />
      </div>
    </div>
  )
}

/** 当前时间（到秒，每秒刷新）—— 给整个作战室一个准确时间锚点。 */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="ml-auto flex items-center gap-1.5 font-mono text-sm tabular-nums text-neutral-500" title="当前时间">
      <Clock className="h-3.5 w-3.5" />
      {now.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

const BTN = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed'
const BTN_PRIMARY = `${BTN} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50`
const BTN_GHOST = `${BTN} border-neutral-200 text-neutral-700 hover:bg-neutral-50`
const BTN_DANGER = `${BTN} border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50`
const BTN_DISABLED = `${BTN} cursor-not-allowed border-neutral-200 text-neutral-300`

function Controls({
  active,
  busy,
  onStart,
  onStop,
  onSettings,
}: {
  active: boolean
  busy: boolean
  onStart: () => void
  onStop: () => void
  onSettings: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      {active ? (
        <>
          <button disabled title="暂停暂未接入（后端只有启动/停止）" className={BTN_DISABLED}>
            <Pause className="h-4 w-4" /> 暂停
          </button>
          <button disabled={busy} onClick={onStop} className={BTN_DANGER}>
            <Square className="h-4 w-4" /> 停止
          </button>
        </>
      ) : (
        <button disabled={busy} onClick={onStart} className={BTN_PRIMARY}>
          <Play className="h-4 w-4" /> 启动
        </button>
      )}
      <button
        disabled={active}
        onClick={onSettings}
        title={active ? '停止后才能修改设置' : '工作室设置'}
        className={active ? BTN_DISABLED : BTN_GHOST}
      >
        <Settings className="h-4 w-4" /> 设置
      </button>
    </div>
  )
}
