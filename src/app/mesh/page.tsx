'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { CommandPanel, type TeamConfig } from '@/components/mesh/command-panel'
import { RunPanel } from '@/components/mesh/run-panel'

/** 炒股 mesh 团队驾驶舱（最小）：看团队跑、用自然语言指挥、看配置。paper only，不接 live。 */
export default function MeshPage() {
  const [config, setConfig] = useState<TeamConfig | null>(null)

  useEffect(() => {
    fetch('/api/mesh/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.config) setConfig(d.config)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
      <div>
        <h1 className="text-lg font-semibold">炒股 Mesh 团队驾驶舱</h1>
        <p className="mt-1 text-sm text-muted-foreground">盯盘 → 决策 → 风控 → paper 成交 → 复盘；可用自然语言指挥。</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">paper 模拟盘</Badge>
          <Badge variant="outline">模式 {config?.mode ?? '…'}</Badge>
          {config && config.blacklist.length > 0 && <Badge variant="outline">黑名单 {config.blacklist.length}</Badge>}
          <Badge variant="outline" className="opacity-50">
            live 未接入
          </Badge>
        </div>
      </div>
      <CommandPanel onConfigChange={setConfig} />
      <RunPanel />
    </div>
  )
}
