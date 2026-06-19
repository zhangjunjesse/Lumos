'use client'

import { useState, useEffect, useCallback } from 'react'
import { WarRoom, type Workshop } from '@/components/mesh/war-room'
import { WorkshopSettings } from '@/components/mesh/workshop-settings'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'

type View = 'warroom' | 'settings'

const TABS = [
  { key: 'workshop', label: '工作室' },
  { key: 'positions', label: '持仓' },
  { key: 'orders', label: '交易记录' },
  { key: 'review', label: '复盘' },
  { key: 'settings', label: '设置' },
]

const STATUS_STYLE: Record<Workshop['status'], { label: string; cls: string }> = {
  active: { label: '启用', cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  paused: { label: '暂停', cls: 'text-amber-700 bg-amber-50 ring-amber-200' },
  draft: { label: '草稿', cls: 'text-neutral-600 bg-neutral-100 ring-neutral-200' },
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
            {active === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-900" />}
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
  const [workshops, setWorkshops] = useState<Workshop[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/mesh/workshops')
      if (r.ok) setWorkshops((await r.json()).workshops ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      await fetch('/api/mesh/workshops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setNewName('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!confirm(`删除工作室「${name}」？会停掉它正在跑的团队、清空它的配置和历史，不可恢复。`)) return
    await fetch(`/api/mesh/workshops?id=${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">工作室</h1>
          <p className="mt-0.5 text-sm text-neutral-500">每个工作室是一套独立的策略团队，点击进入作战室</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="新工作室名称"
            className="w-44 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <button
            onClick={create}
            disabled={creating || !newName.trim()}
            className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            + 新增工作室
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-sm text-neutral-400">加载中…</div>
      ) : workshops.length === 0 ? (
        <div className="py-10 text-sm text-neutral-400">还没有工作室，在右上角起个名字新建一个</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {workshops.map((w) => {
            const st = STATUS_STYLE[w.status] ?? STATUS_STYLE.draft
            return (
              <div
                key={w.id}
                onClick={() => onOpen(w)}
                className="cursor-pointer rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-neutral-900">{w.name}</h3>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ring-1 ${st.cls}`}>{st.label}</span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-500">{w.description || '—'}</p>
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
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(w.id, w.name)
                    }}
                    disabled={w.id === DEFAULT_WORKSHOP_ID}
                    title={w.id === DEFAULT_WORKSHOP_ID ? '默认工作室不可删' : '删除（停 runner + 级联清干净）'}
                    className={
                      w.id === DEFAULT_WORKSHOP_ID
                        ? 'cursor-not-allowed rounded-md px-2.5 py-1 text-sm text-neutral-300'
                        : 'rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50'
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
