'use client'

import { agentMeta } from './agent-meta'
import type { BBEntry } from './war-room'

// 数据库存的是 UTC（datetime('now')，无时区标记）→ 补 Z 解析再转本地，否则界面会差 8 小时。
const fmtTime = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? (s.split(' ')[1] ?? s) : d.toLocaleTimeString('zh-CN', { hour12: false })
}

function ValueView({ value }: { value: unknown }) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <span className="shrink-0 text-neutral-400">{k}</span>
            <span className="break-all text-neutral-700">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>
    )
  }
  return <pre className="overflow-x-auto text-sm text-neutral-600">{JSON.stringify(value, null, 2)}</pre>
}

export function Blackboard({ entries }: { entries: BBEntry[] }) {
  if (!entries.length) {
    return (
      <div className="p-8 text-center text-sm text-neutral-400">还没有数据 —— 启动团队后，这里会实时出现 agent 写入的共享状态</div>
    )
  }

  // 同一 key 的最新版本号，把旧版本标「已被覆盖」（留痕）
  const latest: Record<string, number> = {}
  for (const e of entries) latest[e.key] = Math.max(latest[e.key] ?? 0, e.version)

  // 最新写入排最上面（入参按时间正序，倒转即可）
  const ordered = [...entries].reverse()

  return (
    <div className="space-y-3 p-4">
      {ordered.map((e, i) => {
        const meta = agentMeta(e.writtenBy)
        const stale = e.version < latest[e.key]
        return (
          <div key={`${e.key}-${e.version}-${i}`} className={`rounded-lg border border-neutral-200 p-3 ${stale ? 'opacity-55' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <code className="truncate text-sm font-medium text-neutral-900">{e.key}</code>
                {stale && <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-400">已被 v{latest[e.key]} 覆盖</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">v{e.version}</span>
                <span>{fmtTime(e.writtenAt)}</span>
              </div>
            </div>
            <div className="mt-2 border-l-2 border-neutral-100 pl-3">
              <ValueView value={e.value} />
            </div>
            <div className="mt-2">
              <span className={`rounded px-1.5 py-0.5 text-xs ${meta.color}`}>{meta.name}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
