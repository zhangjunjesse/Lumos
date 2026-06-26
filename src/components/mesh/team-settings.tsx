'use client'

import { useState, useEffect, useCallback } from 'react'
import { agentMeta } from './agent-meta'
import { ModelMenu } from './model-menu'
import { McpPicker } from './mcp-picker'
import { TeamAssistant } from './team-assistant'
import { SELECTABLE_ROLES } from '@/lib/mesh/mesh-constants'
import type { ProviderModelGroup } from '@/types'

type McpOption = { name: string; description: string; builtin?: boolean }

interface Agent {
  id: string
  role: string
  systemPrompt: string
  model?: string
  providerId?: string
  mcpAllowlist: string[]
  topics: string[]
  interval: number
  enabled: boolean
  workMode?: 'active_loop' | 'event_driven'
  mcpStatus?: { name: string; status: string }[]
}

const ROLE_OPTIONS = SELECTABLE_ROLES
// 角色中文标签——现在只是展示用的分组标签,不影响执行(成员职责完全由系统提示词决定)。
const ROLE_LABELS: Record<string, string> = { custom: '自定义 custom', observe: '盯盘 observe', decide: '决策 decide', risk: '风控 risk', review: '复盘 review', research: '研究 research', integration: '集成 integration' }
const HEADERS = { 'content-type': 'application/json' }
const FIELD = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

interface AgentForm {
  id: string
  role: string
  systemPrompt: string
  model: string
  providerId: string
  interval: number
  workMode: 'active_loop' | 'event_driven'
  topics: string
  mcpAllowlist: string[]
}
const EMPTY_FORM: AgentForm = { id: '', role: 'custom', systemPrompt: '', model: '', providerId: '', interval: 60, workMode: 'active_loop', topics: '', mcpAllowlist: [] }

export function TeamSettings({ accountId }: { accountId: string }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ systemPrompt: string; model: string; providerId: string; role: string; interval: number; workMode: 'active_loop' | 'event_driven'; mcpAllowlist: string[] }>({ systemPrompt: '', model: '', providerId: '', role: 'observe', interval: 10, workMode: 'active_loop', mcpAllowlist: [] })
  const [form, setForm] = useState<AgentForm | null>(null)
  const [error, setError] = useState('')
  const [availableMcp, setAvailableMcp] = useState<McpOption[]>([])
  // 服务商+模型双选:列出所有可用服务商的模型(像 chat),每个 agent 自己选服务商+模型。
  const [modelGroups, setModelGroups] = useState<ProviderModelGroup[]>([])
  const [defaultProviderId, setDefaultProviderId] = useState('')
  const [defaultModel, setDefaultModel] = useState('')

  const refresh = useCallback(
    () =>
      fetch(`/api/mesh/agents?accountId=${accountId}`)
        .then((r) => r.json())
        .then((d) => {
          setAgents(d.agents ?? [])
          if (Array.isArray(d.availableMcp)) setAvailableMcp(d.availableMcp)
        })
        .catch(() => {}),
    [accountId],
  )
  useEffect(() => {
    refresh()
  }, [refresh])
  useEffect(() => {
    fetch('/api/providers/models')
      .then((r) => r.json())
      .then((d) => {
        const groups: ProviderModelGroup[] = d.groups ?? []
        setModelGroups(groups) // 所有服务商,供下拉选
        setDefaultProviderId(d.default_provider_id ?? '')
        const def = groups.find((g) => g.provider_id === d.default_provider_id) ?? groups[0]
        setDefaultModel((d.default_model || def?.default_model || '').trim())
      })
      .catch(() => {})
  }, [])

  const toggle = async (id: string, enabled: boolean) => {
    await fetch('/api/mesh/agents', { method: 'POST', headers: HEADERS, body: JSON.stringify({ id, action: 'setEnabled', enabled, accountId }) })
    refresh()
  }
  const startEdit = (a: Agent) => {
    setEditing(a.id)
    setDraft({ systemPrompt: a.systemPrompt, model: a.model ?? '', providerId: a.providerId ?? '', role: a.role, interval: a.interval, workMode: a.workMode ?? 'event_driven', mcpAllowlist: a.mcpAllowlist ?? [] })
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
    const def = modelGroups.find((g) => g.provider_id === defaultProviderId) ?? modelGroups[0]
    // 新成员默认勾上非内置 MCP（行情/数据，免得空手没工具）；下单等内置能力不默认勾，需手动授权。
    setForm({ ...EMPTY_FORM, providerId: def?.provider_id ?? '', model: defaultModel || def?.models[0]?.value || '', mcpAllowlist: availableMcp.filter((m) => !m.builtin).map((m) => m.name) })
    setError('')
  }
  const openClone = (a: Agent) => {
    setForm({ id: `${a.id}_copy`, role: a.role, systemPrompt: a.systemPrompt, model: a.model ?? '', providerId: a.providerId ?? '', interval: a.interval, workMode: a.workMode ?? 'event_driven', topics: a.topics.join('、'), mcpAllowlist: a.mcpAllowlist ?? [] })
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
        providerId: form.providerId || undefined,
        interval: form.interval,
        workMode: form.workMode,
        topics: form.topics.split(/[，,、\s]+/).filter(Boolean),
        mcpAllowlist: form.mcpAllowlist,
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
    const provName = a.providerId ? modelGroups.find((g) => g.provider_id === a.providerId)?.provider_name ?? a.providerId : ''
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

        {isEditing ? (
          <div className="mt-3 space-y-2">
            <textarea value={draft.systemPrompt} onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))} rows={4} className={FIELD} />
            <div className="flex gap-2">
              <select value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} className="w-44 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400">
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                ))}
              </select>
              <ModelMenu groups={modelGroups} value={draft.model} onChange={(pid, m) => setDraft((d) => ({ ...d, providerId: pid, model: m }))} className="flex-1" />
            </div>
            <div className="flex gap-2">
              <select value={draft.workMode} onChange={(e) => setDraft((d) => ({ ...d, workMode: e.target.value as 'active_loop' | 'event_driven' }))} className="w-36 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400">
                <option value="active_loop">主动循环</option>
                <option value="event_driven">被事件唤醒</option>
              </select>
              {draft.workMode === 'active_loop' ? (
                <>
                  <input type="number" value={draft.interval} onChange={(e) => setDraft((d) => ({ ...d, interval: Number(e.target.value) || 0 }))} className="w-20 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400" />
                  <span className="self-center text-xs text-neutral-400">秒/轮</span>
                </>
              ) : (
                <span className="self-center text-xs text-neutral-400">事件触发，无需间隔</span>
              )}
            </div>
            <McpPicker options={availableMcp} value={draft.mcpAllowlist} onChange={(v) => setDraft((d) => ({ ...d, mcpAllowlist: v }))} status={a.mcpStatus} />
            <p className="text-xs text-neutral-400">角色只是展示用的标签,不影响执行;这个成员具体干啥,完全由上面的系统提示词决定。</p>
            <div className="flex gap-2">
              <button onClick={() => saveEdit(a.id)} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">保存</button>
              <button onClick={() => setEditing(null)} className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100">取消</button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 line-clamp-2 text-sm text-neutral-500">{a.systemPrompt}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-neutral-400">
              <span>服务商：{provName || '默认'}</span>
              <span>模型：{a.model || '默认'}</span>
              <span>{a.workMode === 'active_loop' ? `主动每 ${a.interval} 秒` : '被事件唤醒'}</span>
              {a.topics.length > 0 && <span>订阅：{a.topics.join('、')}</span>}
            </div>
            {a.mcpStatus && a.mcpStatus.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {a.mcpStatus.map((s) => (
                  <span key={s.name} className={`rounded px-1.5 py-0.5 ${s.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {s.name}：{s.status === 'connected' ? '已连' : `失败(${s.status})`}
                  </span>
                ))}
              </div>
            )}
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
      <TeamAssistant accountId={accountId} onChanged={refresh} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">团队成员（Agent Registry）—— 配置已接 db，下单能力永不注入</p>
        <button onClick={openCreate} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
          + 新增成员
        </button>
      </div>

      {form && <CreateForm form={form} setForm={setForm} error={error} onSubmit={submitCreate} onCancel={() => setForm(null)} models={modelGroups} mcp={availableMcp} />}

      {leader && card(leader, true)}

      <div className="pt-2 text-xs font-medium text-neutral-400">协作成员（队长除外）</div>
      {others.map((a) => card(a))}
    </div>
  )
}

function CreateForm({ form, setForm, error, onSubmit, onCancel, models, mcp }: { form: AgentForm; setForm: (f: AgentForm) => void; error: string; onSubmit: () => void; onCancel: () => void; models: ProviderModelGroup[]; mcp: McpOption[] }) {
  const set = (patch: Partial<AgentForm>) => setForm({ ...form, ...patch })
  return (
    <div className="space-y-2 rounded-xl border border-neutral-300 bg-neutral-50 p-4">
      <div className="flex gap-2">
        <input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="agent id（如 custom.news）" className={FIELD} />
        <select value={form.role} onChange={(e) => set({ role: e.target.value })} className="w-40 rounded-lg border border-neutral-200 px-2 py-2 text-sm">
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
        </select>
      </div>
      <textarea value={form.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} rows={3} placeholder="systemPrompt（这个 agent 的职责）" className={FIELD} />
      <div className="flex gap-2">
        <ModelMenu groups={models} value={form.model} onChange={(pid, m) => set({ providerId: pid, model: m })} className="flex-1" />
        <select value={form.workMode} onChange={(e) => set({ workMode: e.target.value as AgentForm['workMode'] })} className="w-40 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm">
          <option value="active_loop">主动循环</option>
          <option value="event_driven">被事件唤醒</option>
        </select>
        {form.workMode === 'active_loop' ? (
          <>
            <input type="number" value={form.interval} onChange={(e) => set({ interval: Number(e.target.value) || 0 })} className="w-20 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm" />
            <span className="self-center text-xs text-neutral-400">秒</span>
          </>
        ) : (
          <span className="self-center text-xs text-neutral-400">事件触发，无需间隔</span>
        )}
      </div>
      <p className="text-xs text-neutral-400">服务商 + 模型从「设置 → 服务商」已配置的里选；留空走默认服务商。</p>
      <McpPicker options={mcp} value={form.mcpAllowlist} onChange={(v) => set({ mcpAllowlist: v })} />
      <input value={form.topics} onChange={(e) => set({ topics: e.target.value })} placeholder="订阅事件 topic（顿号分隔，如 quote_anomaly、market_close）" className={FIELD} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSubmit} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">创建</button>
        <button onClick={onCancel} className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100">取消</button>
      </div>
    </div>
  )
}
