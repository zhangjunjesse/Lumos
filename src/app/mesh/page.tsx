'use client'

import { useState } from 'react'
import { WarRoom } from '@/components/mesh/war-room'
import { WorkshopSettings } from '@/components/mesh/workshop-settings'

interface Workshop {
  id: string
  name: string
  desc: string
  status: string
}

type View = 'warroom' | 'settings'

const TABS = [
  { key: 'workshop', label: '工作室' },
  { key: 'positions', label: '持仓' },
  { key: 'orders', label: '交易记录' },
  { key: 'review', label: '复盘' },
  { key: 'settings', label: '设置' },
]

const WORKSHOPS: Workshop[] = [
  { id: '1', name: '低吸打板', desc: '盯涨停回踩，5 日线企稳低吸', status: '运行中' },
  { id: '2', name: '主线轮动', desc: '跟踪当日主线板块，强势股之间轮动换仓', status: '运行中' },
  { id: '3', name: '龙头战法', desc: '只做板块龙头，首阴反包介入', status: '已暂停' },
  { id: '4', name: '北向跟随', desc: '跟随北向资金净流入标的建仓', status: '草稿' },
]

const STATUS_STYLE: Record<string, string> = {
  运行中: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
  已暂停: 'text-amber-700 bg-amber-50 ring-amber-200',
  草稿: 'text-neutral-600 bg-neutral-100 ring-neutral-200',
}

export default function MeshPage() {
  const [active, setActive] = useState('workshop')
  const [selected, setSelected] = useState<Workshop | null>(null)
  const [view, setView] = useState<View>('warroom')

  const switchTab = (key: string) => {
    setActive(key)
    setSelected(null)
  }
  const open = (w: Workshop, v: View) => {
    setSelected(w)
    setView(v)
  }

  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center gap-1 border-b border-neutral-200 px-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`relative px-4 py-3 text-sm transition-colors ${
              active === t.key ? 'font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t.label}
            {active === t.key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-900" />
            )}
          </button>
        ))}
      </nav>

      <main className="px-6 py-6">
        {active === 'workshop' ? (
          selected ? (
            view === 'settings' ? (
              <WorkshopSettings workshop={selected} onBack={() => setSelected(null)} />
            ) : (
              <WarRoom workshop={selected} onBack={() => setSelected(null)} onSettings={() => setView('settings')} />
            )
          ) : (
            <WorkshopTab onOpen={(w) => open(w, 'warroom')} onSettings={(w) => open(w, 'settings')} />
          )
        ) : (
          <div className="py-10 text-sm text-neutral-400">{TABS.find((t) => t.key === active)?.label} —— 内容待设计</div>
        )}
      </main>
    </div>
  )
}

function WorkshopTab({ onOpen, onSettings }: { onOpen: (w: Workshop) => void; onSettings: (w: Workshop) => void }) {
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">工作室</h1>
          <p className="mt-0.5 text-sm text-neutral-500">每个工作室是一套独立的策略团队，点击进入作战室</p>
        </div>
        <button className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          + 新增工作室
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {WORKSHOPS.map((w) => (
          <div
            key={w.id}
            onClick={() => onOpen(w)}
            className="cursor-pointer rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-neutral-900">{w.name}</h3>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ring-1 ${STATUS_STYLE[w.status] ?? STATUS_STYLE['草稿']}`}>
                {w.status}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-500">{w.desc}</p>
            <div className="mt-3 flex items-center gap-1 border-t border-neutral-100 pt-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSettings(w)
                }}
                className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                设置
              </button>
              <button
                onClick={(e) => e.stopPropagation()}
                className="rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
