import {
  normalizeMainAgentConversationHistoryForTeamRuntime,
  type ConversationHistoryEntry,
} from '../team-runtime-history'
import type { MainAgentSessionTeamRuntimeState } from '@/lib/db/tasks'

function buildRuntimeState(): MainAgentSessionTeamRuntimeState {
  return {
    preferredTask: {
      taskId: 'task-1',
      title: 'Midscene report',
      userGoal: 'Deliver the Midscene report',
      approvalStatus: 'approved',
      runStatus: 'running',
      publishedToChat: true,
      currentStage: 'Write final report',
      latestOutput: 'Draft is ready',
      runId: 'run-1',
      deliverablePaths: ['/api/team-runs/run-1/artifacts/artifact-1'],
      updatedAt: '2026-03-15 22:00:00',
    },
    pendingTasks: [],
    additionalTasks: [],
  }
}

describe('normalizeMainAgentConversationHistoryForTeamRuntime', () => {
  test('strips stale approval reminders after a task is approved and appends the latest runtime snapshot', () => {
    const history: ConversationHistoryEntry[] = [
      {
        role: 'assistant',
        content: [
          '主人，现在是北京时间 2026年3月15日 22:13（晚上10点13分）。',
          '',
          '顺便提醒一下，刚才您提出的 Midscene.js 研究任务的团队计划还在等待您的确认。如果现在方便，我可以立即启动团队执行。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: '现在几点钟',
      },
    ]

    const normalized = normalizeMainAgentConversationHistoryForTeamRuntime(history, buildRuntimeState())

    expect(normalized[0]?.content).toContain('现在是北京时间')
    expect(normalized[0]?.content).not.toContain('等待您的确认')
    expect(normalized[normalized.length - 1]?.content).toContain('[Current team runtime snapshot]')
    expect(normalized[normalized.length - 1]?.content).toContain('do not ask for approval again')
  })

  test('removes stale execution-denied lines but keeps real progress updates', () => {
    const history: ConversationHistoryEntry[] = [
      {
        role: 'assistant',
        content: '抱歉主人，我刚才只是提出了团队计划，还没有真正执行。现在立即启动团队任务，为你生成报告。',
      },
      {
        role: 'assistant',
        content: '团队进度 1/3：已完成《研究官网文档》。',
      },
    ]

    const normalized = normalizeMainAgentConversationHistoryForTeamRuntime(history, buildRuntimeState())

    expect(normalized.some((message) => message.content.includes('还没有真正执行'))).toBe(false)
    expect(normalized.some((message) => message.content.includes('团队进度 1/3'))).toBe(true)
  })
})
