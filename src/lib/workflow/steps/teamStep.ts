// 团队步骤:把一个工作流步骤交给平台团队执行(队长按 SOP 派单成员协作)。
// 执行内核在 @/lib/team/run(与聊天团队会话同一套成员解析/工具授权/出图护栏)。
//
// 执行记录:跑完写一条 session 消息(格式与 agent 步骤一致),详情页的「执行过程」Tab、
// 步骤摘要、step-trace API、debug trace 靠它点亮。过去不写,所以团队节点在详情页是黑箱:
// 只剩队长最后那段交付文本,谁接了活、调了什么工具全看不到。

import { runTeamTask } from '@/lib/team/run';
import { getActiveUserId } from '@/lib/auth/user-service';
import { getTeam } from '@/lib/team/store';
import { addMessage } from '@/lib/db/sessions';
import { formatTeamStepOutputMarkdown } from '../team-step-output';
import type { StepResult, TeamStepInput } from '../types';

/** 与 agent 步骤同一条守卫:`workflow:` 前缀是伪会话 id,写不进 messages 表。 */
function resolvePersistSessionId(input: TeamStepInput): string | null {
  const sessionId = input.__runtime?.sessionId;
  if (!sessionId || sessionId.startsWith('workflow:')) return null;
  return sessionId;
}

/**
 * 节点上配置的超时(编译器已写进 __runtime,与 agent 步骤同一个来源)。
 * 必须传给 runTeamTask —— 曾经漏传,于是团队任务一律用 30 分钟硬编码缺省,
 * 用户在节点上把超时调到 100 分钟也毫无效果,只会反复看到「超时」。
 */
function resolveTimeoutMs(input: TeamStepInput): number | undefined {
  const ms = input.__runtime?.timeoutMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export async function teamStep(input: TeamStepInput): Promise<StepResult> {
  if (!input.teamId?.trim()) return { success: false, output: null, error: 'Team step teamId is required' };
  if (!input.task?.trim()) return { success: false, output: null, error: 'Team step task is required' };

  const teamId = input.teamId.trim();
  const stepId = input.__runtime?.stepId || 'team';
  const persistSessionId = resolvePersistSessionId(input);
  const teamName = getTeam(teamId)?.name || '团队';
  const timeoutMs = resolveTimeoutMs(input);
  const startedAt = Date.now();

  try {
    const result = await runTeamTask({
      teamId,
      task: input.task,
      lumosUserId: getActiveUserId() || undefined,
      ...(timeoutMs ? { timeoutMs } : {}),
    });

    persistStepOutput(persistSessionId, {
      stepId,
      teamName,
      text: result.text,
      dispatches: result.dispatches,
      dispatchedTo: result.dispatchedTo,
      trace: result.trace,
      outcome: 'done',
      durationMs: Date.now() - startedAt,
      // 超时/轮次耗尽但有产出:步骤算成功,但必须让详情页看得见「这是被掐断的,产出可能不全」
      ...(result.timedOut ? { timedOutAfterMs: result.timeoutMs } : {}),
      ...(result.turnsExhausted ? { turnsExhausted: true } : {}),
    });

    return {
      success: true,
      output: {
        text: result.text,
        dispatches: result.dispatches,
        dispatched_to: result.dispatchedTo,
      },
      metadata: { teamId, resultSubtype: result.subtype },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 失败也要留痕:否则详情页对失败的团队步骤同样是黑箱(连失败原因都要去别处找)
    persistStepOutput(persistSessionId, {
      stepId,
      teamName,
      text: '',
      dispatches: 0,
      dispatchedTo: [],
      trace: { leader: [], members: [] },
      outcome: 'failed',
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return { success: false, output: null, error: message };
  }
}

/** 写执行记录;写失败不能影响步骤本身的成败判定。 */
function persistStepOutput(
  sessionId: string | null,
  payload: Parameters<typeof formatTeamStepOutputMarkdown>[0],
): void {
  if (!sessionId) return;
  try {
    const md = formatTeamStepOutputMarkdown(payload);
    addMessage(sessionId, 'assistant', JSON.stringify([{ type: 'text', text: md }]));
  } catch (e) {
    console.warn('[teamStep] 写执行记录失败(不影响步骤结果):', e);
  }
}
