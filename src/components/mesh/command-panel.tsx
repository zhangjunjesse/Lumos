'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

export interface TeamConfig {
  blacklist: string[]
  focus: string
  mode: 'auto' | 'observe_only'
}
interface AppliedCommand {
  command: { type: string; [k: string]: unknown }
  relaxesRisk: boolean
}
interface CommandResult {
  reply: string
  applied: AppliedCommand[]
  config: TeamConfig
}

/** 指挥框：自然语言 → Leader 拆命令 → 应用到团队配置。 */
export function CommandPanel({ onConfigChange }: { onConfigChange?: (c: TeamConfig) => void }) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CommandResult | null>(null)

  async function send() {
    if (!message.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/mesh/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '指令失败')
      setResult(data)
      onConfigChange?.(data.config)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">指挥团队</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder='用大白话下令，如"只看不买，别碰 600160.SH"'
          rows={2}
        />
        <div>
          <Button onClick={send} disabled={loading || !message.trim()} size="sm">
            {loading ? '处理中…' : '发送指令'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
            <p>{result.reply}</p>
            <div className="flex flex-wrap gap-1">
              {result.applied.length === 0 ? (
                <span className="text-muted-foreground">无可执行命令</span>
              ) : (
                result.applied.map((a, i) => (
                  <Badge key={i} variant={a.relaxesRisk ? 'destructive' : 'secondary'}>
                    {commandLabel(a.command)}
                    {a.relaxesRisk ? '（放宽风险）' : ''}
                  </Badge>
                ))
              )}
            </div>
            <p className="text-muted-foreground">
              当前：模式 {result.config.mode}｜黑名单{' '}
              {result.config.blacklist.length ? result.config.blacklist.join(',') : '无'}｜关注{' '}
              {result.config.focus || '无'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function commandLabel(c: { type: string; [k: string]: unknown }): string {
  if (c.type === 'set_mode') return `模式→${String(c.mode)}`
  if (c.type === 'set_blacklist') return `${c.add ? '拉黑' : '解禁'}：${(c.symbols as string[])?.join(',')}`
  if (c.type === 'set_focus') return `关注→${String(c.focus)}`
  return c.type
}
