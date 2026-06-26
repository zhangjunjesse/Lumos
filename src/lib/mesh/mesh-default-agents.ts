/**
 * Agent Registry 默认种子 —— 某工作室 db 为空时灌入这一套。
 * 纯通用、零业务：一个团队协调者（管理锚点，AI 团队管家复用它的服务商）+ 一个示例成员（默认停用，
 * 给用户照着改/删的模板）。具体团队由用户在「团队设置」或「AI 团队管家」自建。
 */
import type { MeshAgentConfig, MeshWorkMode } from './mesh-agent-config'

export interface DefaultAgent extends MeshAgentConfig {
  topics: string[]
  interval: number
  enabled: boolean
  workMode: MeshWorkMode
}

const LEADER_PROMPT = `你是这个 agent 团队的协调者。团队有哪些成员、各自什么职责、订阅哪些事件、用哪个服务商，都由用户在「团队设置」里、或通过「AI 团队管家」用自然语言增删改。你不写死任何具体业务——需要了解全队进展时，用 read_blackboard 看共享黑板。`

const EXAMPLE_PROMPT = `这是一个示例成员（可改名 / 可停用 / 可删除）。被定时唤醒时，先用 read_blackboard 看看共享黑板，再按你的职责用 write_blackboard 记录结论、用 emit_event 通知队友、用 send_task 给某个成员派活。请把这段系统提示词改写成你真正要的成员职责，或直接删掉它、用「AI 团队管家」从零搭你自己的团队。`

/** db 某工作室空时 seed 这一套（通用极简，零业务）。leader=管理锚点（event_driven，不自动跑）；
 *  example.member=一个能跑起来的示例（active_loop，仅团队被「启动」后才按 interval 醒），给用户照着改/删。 */
export const MESH_DEFAULT_AGENTS: DefaultAgent[] = [
  { id: 'team.leader', role: 'leader', systemPrompt: LEADER_PROMPT, mcpAllowlist: [], toolAllowlist: [], topics: [], interval: 30, enabled: true, workMode: 'event_driven' },
  { id: 'example.member', role: 'custom', systemPrompt: EXAMPLE_PROMPT, mcpAllowlist: [], toolAllowlist: [], topics: [], interval: 60, enabled: true, workMode: 'active_loop' },
]
