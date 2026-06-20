'use client'

import { useState, useEffect, useCallback } from 'react'
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
  workMode?: 'active_loop' | 'event_driven'
}

const CORE_ROLES = ['observe', 'decide', 'risk', 'review']
const ROLE_OPTIONS = ['observe', 'decide', 'risk', 'review', 'research', 'integration']
const HEADERS = { 'content-type': 'application/json' }
const FIELD = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

interface AgentForm {
  id: string
  role: string
  systemPrompt: string
  model: string
  interval: number
  workMode: 'active_loop' | 'event_driven'
  topics: string
}
const EMPTY_FORM: AgentForm = { id: '', role: 'observe', systemPrompt: '', model: '', interval: 60, workMode: 'event_driven', topics: '' }

export function TeamSettings({ accountId }: { accountId: string }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ systemPrompt: string; model: string; interval: number }>({ systemPrompt: '', model: '', interval: 10 })
  const [form, setForm] = useState<AgentForm | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(
    () =>
      fetch(`/api/mesh/agents?accountId=${accountId}`)
        .then((r) => r.json())
        .then((d) => setAgents(d.agents ?? []))
        .catch(() => {}),
    [accountId],
  )
  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = async (id: string, enabled: boolean) => {
    await fetch('/api/mesh/agents', { method: 'POST', headers: HEADERS, body: JSON.stringify({ id, action: 'setEnabled', enabled, accountId }) })
    refresh()
  }
  const startEdit = (a: Agent) => {
    setEditing(a.id)
    setDraft({ systemPrompt: a.systemPrompt, model: a.model ?? '', interval: a.interval })
  }
  const saveEdit = async (id: string) => {
    await fetch('/api/mesh/agents', { method: 'POST', headers: HEADERS, body: JSON.stringify({ id, ...draft, accountId }) })
    setEditing(null)
    refresh()
  }
  const remove = async (id: string) => {
    await fetch(`/api/mesh/agents?id=${id}&accountId=${accountId}`, { method: 'DELETE' })
    refresh()
  }

  const openCreate = () => {
    setForm({ ...EMPTY_FORM })
    setError('')
  }
  const openClone = (a: Agent) => {
    setForm({ id: `${a.id}_copy`, role: a.role, systemPrompt: a.systemPrompt, model: a.model ?? '', interval: a.interval, workMode: a.workMode ?? 'event_driven', topics: a.topics.join('、') })
    setError('')
  }
  const submitCreate = async () => {
    if (!form) return
    const id = form.id.trim()
    if (!id) return setError('agent id 必填')
    const r = await fetch('/api/mesh/agents', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        action: 'create',
        accountId,
        id,
        role: form.role,
        systemPrompt: form.systemPrompt,
        model: form.model || undefined,
        interval: form.interval,
        workMode: form.workMode,
        topics: form.topics.split(/[，,、\s]+/).filter(Boolean),
        enabled: true,
      }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return setError(d.error || '新增失败')
    }
    setForm(null)
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

        {!a.enabled && CORE_ROLES.includes(a.role) && <p className="mt-2 text-xs text-amber-600">⚠ 停用核心角色会中断协作链（盯盘→决策→风控→复盘）</p>}

        {isEditing ? (
          <div className="mt-3 space-y-2">
            <textarea value={draft.systemPrompt} onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))} rows={4} className={FIELD} />
            <div className="flex gap-2">
              <input value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} placeholder="模型（留空用默认）" className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400" />
              <input type="number" value={draft.interval} onChange={(e) => setDraft((d) => ({ ...d, interval: Number(e.target.value) || 0 }))} className="w-24 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400" />
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
              <span>{a.workMode === 'active_loop' ? `主动每 ${a.interval} 秒` : '被事件唤醒'}</span>
              {a.topics.length > 0 && <span>订阅：{a.topics.join('、')}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1 border-t border-neutral-100 pt-3">
              <button onClick={() => startEdit(a)} className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100">编辑</button>
              {!lead && <button onClick={() => openClone(a)} className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100">克隆</button>}
              {!lead && <button onClick={() => remove(a.id)} className="rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50">删除</button>}
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
        <button onClick={openCreate} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
          + 新增成员
        </button>
      </div>

      {form && <CreateForm form={form} setForm={setForm} error={error} onSubmit={submitCreate} onCancel={() => setForm(null)} />}

      {leader && card(leader, true)}

      <div className="pt-2 text-xs font-medium text-neutral-400">协作成员（盯盘 → 决策 → 风控 → 复盘）</div>
      {others.map((a) => card(a))}
    </div>
  )
}

function CreateForm({ form, setForm, error, onSubmit, onCancel }: { form: AgentForm; setForm: (f: AgentForm) => void; error: string; onSubmit: () => void; onCancel: () => void }) {
  const set = (patch: Partial<AgentForm>) => setForm({ ...form, ...patch })
  return (
    <div className="space-y-2 rounded-xl border border-neutral-300 bg-neutral-50 p-4">
      <div className="flex gap-2">
        <input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="agent id（如 custom.news）" className={FIELD} />
        <select value={form.role} onChange={(e) => set({ role: e.target.value })} className="w-32 rounded-lg border border-neutral-200 px-2 py-2 text-sm">
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <textarea value={form.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} rows={3} placeholder="systemPrompt（这个 agent 的职责）" className={FIELD} />
      <div className="flex gap-2">
        <input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="模型（留空默认）" className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm" />
        <select value={form.workMode} onChange={(e) => set({ workMode: e.target.value as AgentForm['workMode'] })} className="w-40 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm">
          <option value="active_loop">主动循环</option>
          <option value="event_driven">被事件唤醒</option>
        </select>
        <input type="number" value={form.interval} onChange={(e) => set({ interval: Number(e.target.value) || 0 })} className="w-20 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm" />
        <span className="self-center text-xs text-neutral-400">秒</span>
      </div>
      <input value={form.topics} onChange={(e) => set({ topics: e.target.value })} placeholder="订阅事件 topic（顿号分隔，如 quote_anomaly、market_close）" className={FIELD} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSubmit} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">创建</button>
        <button onClick={onCancel} className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100">取消</button>
      </div>
    </div>
  )
}
