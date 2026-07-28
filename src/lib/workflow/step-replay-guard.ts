// 重放风暴熔断(#54)。
//
// openworkflow 的写回带 worker_id 校验(completeStepAttempt / failStepAttempt 的
// SQL 里都有 `AND wr.worker_id = ?`)。租约一丢,worker_id 被改写,成功和失败都
// 写不回去 —— step_attempts 那行永远停在 running、finished_at 与 error 全空。
// 调度器看不到终态,就把 run 当成没人做,反复重新 claim(attempts 一路涨),
// 同一个步骤被真实执行几百次。实测 archive-ledger 重放 515 次,每次都真跑一遍
// python 写 Excel + ImageMagick 合图;6 个僵尸 run 累计空转 1861 次。
//
// #54 的根因(脚本冻结事件循环)已经在 code-worker-host 里根治,但心跳掉线的原因
// 不止一种(机器休眠、极端负载、别处的同步阻塞),所以这里留一道独立的闸:
// 同一步骤在一次 run 里堆了太多写不回的 running 记录,就判定风暴、终止 run,
// 并把原因写进 step_attempts.error —— 这也是用户第一次能在 UI 上看见它。

import Database from 'better-sqlite3';
import path from 'path';
// 走 run-workspace-paths 而不是 openworkflow-client:后者拖着 ESM-only 的
// @openworkflow/backend-sqlite,而本模块被 runtime.ts 引用 —— 那会把整片引擎单测拖炸。
import { getLumosDataDir } from './run-workspace-paths';
import type { WorkflowStepRuntimeContext } from './types';

/** 同一步骤在一次 run 里最多真实执行几次。 */
export const MAX_STEP_EXECUTIONS_PER_RUN = 3;

export class WorkflowReplayStormError extends Error {
  /** 熔断是终态判定,不能被 __executeStep 的 step 级重试再吃一轮。 */
  readonly nonRetryable = true;
  readonly stepId: string;
  readonly executions: number;

  constructor(stepId: string, executions: number) {
    super(
      `步骤「${stepId}」已被重复执行 ${executions} 次,每次结果都没能写回数据库,`
      + `判定为重放风暴并终止工作流。`
      + `常见原因:步骤里有长时间同步阻塞(如 child_process.execFileSync / spawnSync)`
      + `冻结了事件循环,导致执行租约过期、任务被重新派发,完成状态因此写不回去。`
      + `请把外部命令改成异步执行方式。`,
    );
    this.name = 'WorkflowReplayStormError';
    this.stepId = stepId;
    this.executions = executions;
  }
}

/**
 * 数没写回终态的 running 记录条数。
 *
 * 正常路径下只有 1 条 —— 就是当前这次(step.run 会先 createStepAttempt 再调用
 * 步骤实现)。多出来的每一条都对应一次「跑完了但没写回」。
 */
function countUnfinishedAttempts(workflowRunId: string, stepName: string): number {
  const dbPath = path.join(getLumosDataDir(), 'workflows.db');
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    // 还没建库(单测、首次运行)就不存在重放历史。
    return 0;
  }

  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS n
      FROM step_attempts
      WHERE workflow_run_id = ?
        AND step_name = ?
        AND status = 'running'
        AND finished_at IS NULL
    `).get(workflowRunId, stepName) as { n: number } | undefined;
    return row?.n ?? 0;
  } finally {
    db.close();
  }
}

/**
 * 步骤开跑前的闸门。检测到重放风暴就抛 {@link WorkflowReplayStormError}。
 *
 * 守卫本身查库失败时放行 —— 它是安全网,不该反过来挡住正常业务。
 */
export function assertNoReplayStorm(runtime: WorkflowStepRuntimeContext | undefined): void {
  const workflowRunId = runtime?.workflowRunId;
  const stepId = runtime?.stepId;
  if (!workflowRunId || !stepId) {
    return;
  }

  let unfinished: number;
  try {
    unfinished = countUnfinishedAttempts(workflowRunId, stepId);
  } catch (error) {
    console.warn(
      `[replay-guard] 无法统计 ${workflowRunId}/${stepId} 的重放次数,放行:`,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  // unfinished 含当前这次,所以第 N 次执行时它等于 N。
  if (unfinished > MAX_STEP_EXECUTIONS_PER_RUN) {
    throw new WorkflowReplayStormError(stepId, unfinished - 1);
  }
}
