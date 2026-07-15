// 团队步骤:把一个工作流步骤交给平台团队执行(队长按 SOP 派单成员协作)。
// 执行内核在 @/lib/team/run(与聊天团队会话同一套成员解析/工具授权/出图护栏)。

import { runTeamTask } from '@/lib/team/run';
import { getActiveUserId } from '@/lib/auth/user-service';
import type { StepResult, TeamStepInput } from '../types';

export async function teamStep(input: TeamStepInput): Promise<StepResult> {
  if (!input.teamId?.trim()) return { success: false, output: null, error: 'Team step teamId is required' };
  if (!input.task?.trim()) return { success: false, output: null, error: 'Team step task is required' };

  try {
    const result = await runTeamTask({
      teamId: input.teamId.trim(),
      task: input.task,
      lumosUserId: getActiveUserId() || undefined,
    });
    return {
      success: true,
      output: {
        text: result.text,
        dispatches: result.dispatches,
        dispatched_to: result.dispatchedTo,
      },
      metadata: { teamId: input.teamId, resultSubtype: result.subtype },
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
