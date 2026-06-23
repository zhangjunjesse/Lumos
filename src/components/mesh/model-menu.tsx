'use client'

// mesh 模型选择器 —— 复刻聊天框的模型下拉:触发按钮显示「服务商 / 模型」,
// 点开是按服务商分组的弹层(带单价、勾选当前),不是原生 select。
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { formatYuanPerMtok } from '@/lib/pricing'
import type { ProviderModelGroup } from '@/types'

export function ModelMenu({ groups, value, onChange, className }: {
  groups: ProviderModelGroup[]
  value: string
  onChange: (providerId: string, model: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // 找当前选中模型所在的 group + label
  let curGroup: ProviderModelGroup | undefined
  let curLabel = ''
  for (const g of groups) {
    const m = g.models.find((x) => x.value === value)
    if (m) {
      curGroup = g
      curLabel = m.label
      break
    }
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:border-neutral-400"
      >
        {value ? (
          <>
            {curGroup && <span className="shrink-0 text-[10px] leading-none text-neutral-400">{curGroup.provider_name}</span>}
            {curGroup && <span className="mx-0.5 text-neutral-300">/</span>}
            <span className="truncate font-mono text-xs">{curLabel || value}</span>
          </>
        ) : (
          <span className="text-neutral-400">选择模型</span>
        )}
        <ChevronDown className={`ml-auto h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-96 w-72 overflow-y-auto rounded-lg border bg-white shadow-lg">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-xs text-neutral-400">没有可用模型 —— 去「设置 → 服务商」配置</div>
          )}
          {groups.map((group, gi) => (
            <div key={group.provider_id} className={gi > 0 ? 'border-t' : ''}>
              <div className="bg-neutral-50 px-3 py-1.5">
                <span className="truncate text-xs font-medium text-neutral-600">{group.provider_name}</span>
              </div>
              <div className="py-0.5">
                {group.models.map((opt) => {
                  const active = opt.value === value
                  const inP = formatYuanPerMtok(opt.input_price_per_mtok)
                  const outP = formatYuanPerMtok(opt.output_price_per_mtok)
                  const hasPrice = Boolean(inP || outP)
                  return (
                    <button
                      key={`${group.provider_id}-${opt.value}`}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${active ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                      onClick={() => {
                        onChange(group.provider_id, opt.value)
                        setOpen(false)
                      }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-mono text-xs">{opt.label}</span>
                        {hasPrice && (
                          <span className="text-[10px] leading-none text-neutral-400">
                            输入 {inP ?? '—'} · 输出 {outP ?? '—'} / 1M tokens
                          </span>
                        )}
                      </div>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-neutral-900" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
