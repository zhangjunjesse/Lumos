'use client'

import { useState, useEffect } from 'react'
import { agentMeta } from './agent-meta'

interface Agent {
  id: string
  role: string
  systemPrompt: string
  model?: string
  mcpAllowlist: string[]
  topics: string[]
  interval: number
  enabled: boolean
}

const CORE_ROLES = ['observe', 'decide', 'risk', 'review']
const HEADERS = { 'content-type': 'application/json' }

export function TeamSettings() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ systemPrompt: string; model: string; interval: number }>({ systemPrompt: '', model: '', interval: 10 })

  const refresh = () =>
    fetch('/api/mesh/agents')
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  const toggle = async (id: string, enabled: boolean) => {
    await fetch('/api/mesh/agents', { method: 'POST', headers: HEADERS, body: JSON.stringify({ id, action: 'setEnabled', enabled }) })
    refresh()
  }
  const startEdit = (a: Agent) => {
    setEditing(a.id)
    setDraft({ systemPrompt: a.systemPrompt, model: a.model ?? '', interval: a.interval })
  }
  const saveEdit = async (id: string) => {
    await fetch('/api/mesh/agents', { method: 'POST', headers: HEADERS, body: JSON.stringify({ id, ...draft }) })
    setEditing(null)
    refresh()
  }
  const remove = async (id: string) => {
    await fetch(`/api/mesh/agents?id=${id}`, { method: 'DELETE' })
    refresh()
  }

  const leader = agents.find((a) => a.role === 'leader')
  const others = agents.filter((a) => a.role !== 'leader')

  const card = (a: Agent, lead = false) => {
    const meta = agentMeta(a.id)
    const isEditing = editing === a.id
    return (
      <div key={a.id} className={`rounded-xl border p-4 ${lead ? 'border-indigo-200 bg-indigo-50/40' : a.enabled ? 'border-neutral-200' : 'border-neutral-200 opacity-60'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs ${meta.color}`}>{meta.name}</span>
            {lead && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">队长</span>}
            <code className="truncate text-xs text-neutral-400">{a.id}</code>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-sm text-neutral-600">
            <input type="checkbox" checked={a.enabled} onChange={(e) => toggle(a.id, e.target.checked)} className="h-4 w-4" />
            启用
          </label>
        </div>

        {!a.enabled && CORE_ROLES.includes(a.role) && (
          <p className="mt-2 text-xs text-amber-600">⚠ 停用核心角色会中断协作链（盯盘→决策→风控→复盘）</p>
        )}

        {isEditing ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={draft.systemPrompt}
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <div className="flex gap-2">
              <input
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                placeholder="模型（留空用默认）"
                className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
              />
              <input
                type="number"
                value={draft.interval}
                onChange={(e) => setDraft((d) => ({ ...d, interval: Number(e.target.value) || 0 }))}
                className="w-24 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
              />
              <span className="self-center text-xs text-neutral-400">秒/轮</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => saveEdit(a.id)} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">保存</button>
              <button onClick={() => setEditing(null)} className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100">取消</button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 line-clamp-2 text-sm text-neutral-500">{a.systemPrompt}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-neutral-400">
              <span>模型：{a.model || '默认'}</span>
              <span>能力：{a.mcpAllowlist.join('、') || '无'}</span>
              <span>每 {a.interval} 秒/轮</span>
              {a.topics.length > 0 && <span>订阅：{a.topics.join('、')}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1 border-t border-neutral-100 pt-3">
              <button onClick={() => startEdit(a)} className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100">编辑</button>
              {!lead && (
                <button onClick={() => remove(a.id)} className="rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50">删除</button>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">团队成员（Agent Registry）—— 配置已接 db，下单能力永不注入</p>
        <button title="新增/克隆 agent 后续接入" disabled className="shrink-0 cursor-not-allowed rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-300">
          + 新增成员
        </button>
      </div>

      {leader && card(leader, true)}

      <div className="pt-2 text-xs font-medium text-neutral-400">协作成员（盯盘 → 决策 → 风控 → 复盘）</div>
      {others.map((a) => card(a))}
    </div>
  )
}
