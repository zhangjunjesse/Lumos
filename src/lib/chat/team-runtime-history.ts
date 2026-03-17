import type { MainAgentSessionTeamRuntimeState } from '@/lib/db/tasks'

export interface ConversationHistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

const TEAM_KEYWORDS = /(团队|team|计划|任务|运行)/i
const ACTIVE_TEAM_STATUS = /(团队进度|团队运行已开始|已批准团队计划|已完成《|开始处理《|Final Summary)/i
const STALE_APPROVAL_OR_EXECUTION = [
  /等待.{0,20}确认/i,
  /still requires approval/i,
  /还没有真正执行/i,
  /只是提出了团队计划/i,
  /现在立即启动团队任务/i,
  /现在立即启动团队执行/i,
  /可以立即启动团队执行/i,
]

function hasApprovedRuntimeTruth(runtimeState: MainAgentSessionTeamRuntimeState | null | undefined): boolean {
  return runtimeState?.preferredTask?.approvalStatus === 'approved'
}

function shouldStripAssistantLine(line: string): boolean {
  const normalized = line.trim()
  if (!normalized) {
    return false
  }
  if (ACTIVE_TEAM_STATUS.test(normalized)) {
    return false
  }
  if (!TEAM_KEYWORDS.test(normalized)) {
    return false
  }
  return STALE_APPROVAL_OR_EXECUTION.some((pattern) => pattern.test(normalized))
}

function stripStaleTeamLines(content: string): string {
  const lines = content.split('\n')
  const keptLines = lines.filter((line) => !shouldStripAssistantLine(line))

  while (keptLines[0]?.trim() === '') {
    keptLines.shift()
  }
  while (keptLines[keptLines.length - 1]?.trim() === '') {
    keptLines.pop()
  }

  return keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function buildApprovedRuntimeSnapshot(runtimeState: MainAgentSessionTeamRuntimeState): ConversationHistoryEntry | null {
  const preferredTask = runtimeState.preferredTask
  if (!preferredTask || preferredTask.approvalStatus !== 'approved') {
    return null
  }

  const lines = [
    '[Current team runtime snapshot]',
    `Task: ${preferredTask.title}`,
    `Approval: ${preferredTask.approvalStatus}`,
    `Run status: ${preferredTask.runStatus}`,
  ]

  if (preferredTask.currentStage) {
    lines.push(`Current stage: ${preferredTask.currentStage}`)
  }
  if (preferredTask.deliverablePaths.length > 0) {
    lines.push(`Deliverable paths: ${preferredTask.deliverablePaths.join(' | ')}`)
  }
  lines.push('Rule: do not ask for approval again. For unrelated questions, answer directly without team reminders.')

  return {
    role: 'assistant',
    content: lines.join('\n'),
  }
}

export function normalizeMainAgentConversationHistoryForTeamRuntime(
  history: ConversationHistoryEntry[],
  runtimeState: MainAgentSessionTeamRuntimeState | null,
): ConversationHistoryEntry[] {
  if (!hasApprovedRuntimeTruth(runtimeState)) {
    return history
  }

  const approvedRuntimeState = runtimeState as MainAgentSessionTeamRuntimeState

  const sanitized = history
    .map((message) => {
      if (message.role !== 'assistant') {
        return message
      }

      const content = stripStaleTeamLines(message.content)
      if (!content) {
        return null
      }

      return {
        ...message,
        content,
      }
    })
    .filter((message): message is ConversationHistoryEntry => Boolean(message))

  const snapshot = buildApprovedRuntimeSnapshot(approvedRuntimeState)
  if (snapshot) {
    sanitized.push(snapshot)
  }

  return sanitized
}
