/**
 * Team Leader（管理面）+ Control Plane（确定性应用面）。按 workshopId 隔离：每个工作室有自己的队长 + 配置。
 * - runLeader：把用户自然语言拆成结构化控制命令（LLM）。
 * - applyCommands：确定性把命令应用到 team config + 审计落盘。
 * Leader 只产命令意图，够不到改配置/下单/券商写——改配置由 applyCommands 这层确定性代码做。
 */
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db/connection'
import { runMeshAgentStructured } from './mesh-worker'
import {
  buildLeaderSchema,
  parseLeaderResult,
  relaxesRisk,
  type LeaderCommand,
  type LeaderResult,
} from './mesh-command-schema'
import { getTeamConfig, upsertTeamConfig, type TeamConfig } from './mesh-team-config'
import { getAgent } from './mesh-agent-store'
import { DEFAULT_WORKSHOP_ID } from './mesh-constants'
import type { MeshAgentConfig } from './mesh-agent-config'

const LEADER_AGENT: MeshAgentConfig = {
  id: 'team.leader',
  role: 'leader',
  systemPrompt: `你是炒股 AI 团队的队长(Leader)。把用户的自然语言指令拆成结构化控制命令：
- set_blacklist {symbols:[代码], add:true/false}：拉黑某股用 add:true，解禁用 add:false。
- set_focus {focus:"关注重点"}：如"重点看半导体"。
- set_mode {mode:"auto"|"observe_only"}：只看不买/暂停下单用 observe_only，恢复自动交易用 auto。
reply 用一句话复述你的理解。看不懂或无可执行命令时 commands 留空、reply 说明。
你只产命令，不直接改配置、不下单、也够不到下单工具。`,
  mcpAllowlist: [],
  toolAllowlist: [],
}

/** Leader：把用户自然语言拆成结构化命令（LLM）。workshopId 缺省默认工作室。 */
export async function runLeader(
  userMessage: string,
  options: { sessionId?: string; workshopId?: string } = {},
): Promise<LeaderResult> {
  const workshopId = options.workshopId ?? DEFAULT_WORKSHOP_ID
  const config = getTeamConfig(workshopId)
  const prompt = `当前团队配置：${JSON.stringify(config)}\n\n用户指令：${userMessage}\n\n据此拆成控制命令。`
  const leaderAgent = getAgent(workshopId, 'team.leader') ?? LEADER_AGENT // db registry 配置，缺省回落默认
  const { structured } = await runMeshAgentStructured(leaderAgent, prompt, buildLeaderSchema(), { sessionId: options.sessionId })
  return parseLeaderResult(structured)
}

export interface AppliedCommand {
  command: LeaderCommand
  relaxesRisk: boolean
}

/** Control Plane：确定性应用命令到某工作室的 team config + 审计落盘。 */
export function applyCommands(
  rawMessage: string,
  commands: LeaderCommand[],
  workshopId: string = DEFAULT_WORKSHOP_ID,
): { applied: AppliedCommand[]; config: TeamConfig } {
  const db = getDb()
  const applied: AppliedCommand[] = []
  let config = getTeamConfig(workshopId)
  for (const cmd of commands) {
    config = applyOne(cmd, config, workshopId)
    const relaxes = relaxesRisk(cmd)
    db.prepare('INSERT INTO mesh_command (id, raw_message, command_json, relaxes_risk, workshop_id) VALUES (?, ?, ?, ?, ?)').run(
      `cmd_${randomUUID()}`,
      rawMessage,
      JSON.stringify(cmd),
      relaxes ? 1 : 0,
      workshopId,
    )
    applied.push({ command: cmd, relaxesRisk: relaxes })
  }
  return { applied, config }
}

function applyOne(cmd: LeaderCommand, config: TeamConfig, workshopId: string): TeamConfig {
  let next: TeamConfig = config
  if (cmd.type === 'set_blacklist') {
    const set = new Set(config.blacklist)
    if (cmd.add) cmd.symbols.forEach((s) => set.add(s))
    else cmd.symbols.forEach((s) => set.delete(s))
    next = { ...config, blacklist: Array.from(set) }
  } else if (cmd.type === 'set_focus') {
    next = { ...config, focus: cmd.focus }
  } else if (cmd.type === 'set_mode') {
    next = { ...config, mode: cmd.mode }
  }
  upsertTeamConfig(workshopId, next)
  return next
}
