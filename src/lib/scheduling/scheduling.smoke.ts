import crypto from 'crypto';
import { closeDb, getDb } from '../db/connection';
import { cancelTask, createTask, getTaskDetail } from '../task-management';
import { resetWorkflowEngineForTests, shutdownWorker } from '../workflow/api';
import { resetSchedulingForTests } from './api';

async function waitForTaskTerminal(
  taskId: string,
  getTaskDetail: (request: { taskId: string }) => { task: { status: string; result?: unknown; metadata?: unknown } },
  timeoutMs = 10_000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const detail = getTaskDetail({ taskId });
    if (['completed', 'failed', 'cancelled'].includes(detail.task.status)) {
      return detail;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for task ${taskId}`);
}

async function main() {
  try {
    resetSchedulingForTests();
    await resetWorkflowEngineForTests();

    const sessionId = createSmokeSession();
    const created = createTask({
      taskSummary: '生成 AI 医疗领域调研摘要',
      requirements: ['保留关键结论', '输出简洁结果'],
      context: {
        sessionId,
        relevantMessages: ['用户希望先拿到一版可读的摘要。'],
      },
    });

    const detail = await waitForTaskTerminal(created.taskId, getTaskDetail);
    console.log(JSON.stringify({
      created,
      detail,
    }, null, 2));

    if (detail.task.status !== 'completed') {
      throw new Error(`Task finished with unexpected status: ${detail.task.status}`);
    }

    const outputs = (detail.task.result as { outputs?: Record<string, { success?: boolean; output?: { content?: string } }> } | undefined)?.outputs;
    if (!outputs?.main?.success) {
      throw new Error(`Task result is missing stable "main" step output: ${JSON.stringify(detail.task.result)}`);
    }

    const cancelledTask = createTask({
      taskSummary: '生成可取消的测试任务',
      requirements: ['验证取消链路'],
      context: {
        sessionId,
      },
    });

    const cancelResult = await cancelTask({
      taskId: cancelledTask.taskId,
      reason: 'smoke cancel',
    });

    if (!cancelResult.success) {
      throw new Error(`Cancel request failed: ${JSON.stringify(cancelResult)}`);
    }

    const cancelledDetail = await waitForTaskTerminal(cancelledTask.taskId, getTaskDetail);
    console.log(JSON.stringify({
      cancelledTask,
      cancelResult,
      cancelledDetail,
    }, null, 2));

    if (cancelledDetail.task.status !== 'cancelled') {
      throw new Error(`Cancelled task finished with unexpected status: ${cancelledDetail.task.status}`);
    }
  } finally {
    await shutdownWorker();
    await resetWorkflowEngineForTests();
    resetSchedulingForTests();
    closeDb({ silent: true });
  }
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

function createSmokeSession(): string {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    [
      'INSERT INTO chat_sessions',
      '(id, title, created_at, updated_at, model, requested_model, resolved_model, system_prompt, working_directory, sdk_session_id, project_name, status, mode, sdk_cwd, folder)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ].join(' ')
  ).run(
    id,
    'Scheduling Smoke',
    now,
    now,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'active',
    'code',
    '',
    ''
  );

  return id;
}
