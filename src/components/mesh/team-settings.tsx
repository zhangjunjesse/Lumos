'use client'

import { agentMeta } from './agent-meta'

// 每个成员（含队长）都有自己的运行节奏（设计 §70/§71/§145：participant 是责任单元 + 自己的工作循环）。
interface AgentRow {
  id: string
  model: string
  mcp: string[]
  interval: number // 每隔几秒自己跑一次
  note: string // 大白话：它一轮里干嘛
  duty?: string // 队长额外的对外职责
  enabled: boolean
}

const LEADER: AgentRow = {
  id: 'team.leader',
  model: '强模型',
  mcp: ['行情/持仓查询', 'DeepSearch', 'mesh 只读', 'Control Plane'],
  interval: 30,
  note: '巡检团队状态、响应你的指令',
  duty: '对外接口 · 把你的话拆成命令 · 指挥调度 · 管理团队配置',
  enabled: true,
}

const AGENTS: AgentRow[] = [
  { id: 'stock.observe', model: '默认模型', mcp: ['qmt-readonly'], interval: 5, note: '盯盘面异动、持仓风险', enabled: true },
  { id: 'stock.decide', model: '默认模型', mcp: ['qmt-readonly'], interval: 10, note: '综合盘面做买卖判断', enabled: true },
  { id: 'stock.risk', model: '默认模型', mcp: ['qmt-readonly'], interval: 10, note: '盯总敞口、审下单提议', enabled: true },
  { id: 'stock.review', model: '默认模型', mcp: ['（无）'], interval: 300, note: '每轮收盘后归因复盘', enabled: true },
]

function AgentCard({ agent, lead }: { agent: AgentRow; lead?: boolean }) {
  const meta = agentMeta(agent.id)
  return (
    <div className={`rounded-xl border p-4 ${lead ? 'border-indigo-200 bg-indigo-50/40' : 'border-neutral-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${meta.color}`}>{meta.name}</span>
          {lead && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">队长</span>}
          <code className="truncate text-xs text-neutral-400">{agent.id}</code>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-neutral-600">
          <input type="checkbox" defaultChecked={agent.enabled} className="h-4 w-4" />
          启用
        </label>
      </div>

      {agent.duty && <p className="mt-2 text-sm text-neutral-600">{agent.duty}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-neutral-400">模型</div>
          <div className="text-neutral-700">{agent.model}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">{lead ? '可用能力' : 'MCP 能力'}</div>
          <div className="text-neutral-700">{agent.mcp.join('、')}</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-neutral-50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          每
          <input
            defaultValue={agent.interval}
            className="w-14 rounded border border-neutral-200 px-2 py-0.5 text-center outline-none focus:border-neutral-400"
          />
          秒跑一次
        </div>
        <p className="mt-1 text-xs text-neutral-400">{agent.note}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border-t border-neutral-100 pt-3">
        <button className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100">编辑提示词</button>
        <button className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100">改模型</button>
        {!lead && <button className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100">克隆</button>}
        {!lead && <button className="rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50">停用</button>}
      </div>
    </div>
  )
}

export function TeamSettings() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">团队成员 —— 每个成员有自己的运行节奏，下单能力永不注入</p>
        <button className="shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
          + 新增成员
        </button>
      </div>

      <AgentCard agent={LEADER} lead />

      <div className="pt-2 text-xs font-medium text-neutral-400">协作成员（盯盘 → 决策 → 风控 → 复盘）</div>
      {AGENTS.map((a) => (
        <AgentCard key={a.id} agent={a} />
      ))}
    </div>
  )
}
