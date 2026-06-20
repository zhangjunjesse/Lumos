/**
 * Leader 控制命令 —— 用户自然语言被 Leader agent 拆成这些结构化命令，
 * 再由 Control Plane（确定性）应用到团队配置。命令是白名单，没有"直接下单/改券商"。
 */
export interface SetBlacklistCommand {
  type: 'set_blacklist'
  symbols: string[]
  add: boolean // true=加入黑名单, false=移出(放宽风险)
}
export interface SetFocusCommand {
  type: 'set_focus'
  focus: string
}
export interface SetModeCommand {
  type: 'set_mode'
  mode: 'auto' | 'observe_only'
}

export type LeaderCommand = SetBlacklistCommand | SetFocusCommand | SetModeCommand

export interface LeaderResult {
  reply: string
  commands: LeaderCommand[]
}

/** Leader 的 SDK 结构化输出 schema。 */
export function buildLeaderSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'commands'],
    properties: {
      reply: { type: 'string' },
      commands: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['set_blacklist', 'set_focus', 'set_mode'] },
            symbols: { type: 'array', items: { type: 'string' } },
            add: { type: 'boolean' },
            focus: { type: 'string' },
            mode: { type: 'string', enum: ['auto', 'observe_only'] },
          },
        },
      },
    },
  }
}

export function parseLeaderResult(raw: unknown): LeaderResult {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const reply = typeof o.reply === 'string' ? o.reply : ''
  const rawCmds = Array.isArray(o.commands) ? o.commands : []
  const commands: LeaderCommand[] = []
  for (const c of rawCmds) {
    const cmd = normalizeCommand(c)
    if (cmd) commands.push(cmd)
  }
  return { reply, commands }
}

function normalizeCommand(c: unknown): LeaderCommand | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  if (o.type === 'set_blacklist' && Array.isArray(o.symbols)) {
    return { type: 'set_blacklist', symbols: o.symbols.map(String).filter(Boolean), add: o.add !== false }
  }
  if (o.type === 'set_focus' && typeof o.focus === 'string') {
    return { type: 'set_focus', focus: o.focus }
  }
  if (o.type === 'set_mode' && (o.mode === 'auto' || o.mode === 'observe_only')) {
    return { type: 'set_mode', mode: o.mode }
  }
  return null
}

/** 命令是否放宽风险（移出黑名单 / 切回 auto）——这类要审计留痕。 */
export function relaxesRisk(cmd: LeaderCommand): boolean {
  if (cmd.type === 'set_blacklist' && cmd.add === false) return true
  if (cmd.type === 'set_mode' && cmd.mode === 'auto') return true
  return false
}
