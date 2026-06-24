'use client'

interface McpOption {
  name: string
  description: string
}

/** 给单个 agent 勾选 MCP 工具(行情/账户等只读能力)。下单类永不出现在这里。 */
export function McpPicker({
  options,
  value,
  onChange,
}: {
  options: McpOption[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name])
  return (
    <div className="space-y-1">
      <p className="text-xs text-neutral-500">MCP 工具(授给这个成员的行情/数据能力;下单永不在此)</p>
      {options.length === 0 ? (
        <p className="text-xs text-neutral-400">暂无可用 MCP 工具</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const on = value.includes(o.name)
            return (
              <label
                key={o.name}
                title={o.description}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${on ? 'border-neutral-400 bg-neutral-100 text-neutral-800' : 'border-neutral-200 text-neutral-500'}`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(o.name)} className="h-3.5 w-3.5" />
                {o.name}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
