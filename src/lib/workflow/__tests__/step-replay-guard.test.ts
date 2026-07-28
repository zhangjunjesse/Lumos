// 重放风暴熔断(#54)。
// 病史:租约丢失后写回被 worker_id 校验挡下,step_attempts 永远停在 running,
// 调度器反复重新 claim,同一步骤被真实执行 515 次(每次都真跑 python + ImageMagick)。
// 这道闸负责在堆到第 N 条写不回的 running 记录时终止 run。

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MAX_STEP_EXECUTIONS_PER_RUN,
  WorkflowReplayStormError,
  assertNoReplayStorm,
} from '../step-replay-guard';
import type { WorkflowStepRuntimeContext } from '../types';

let dataDir: string;
const originalDataDir = process.env.LUMOS_DATA_DIR;

function runtime(stepId = 'archive-ledger', workflowRunId = 'run-1'): WorkflowStepRuntimeContext {
  return { workflowRunId, stepId, stepType: 'agent' };
}

function openDb(): Database.Database {
  return new Database(path.join(dataDir, 'workflows.db'));
}

function createSchema(): void {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS step_attempts (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL,
      finished_at TEXT
    )
  `);
  db.close();
}

function seedAttempts(input: {
  count: number;
  stepName?: string;
  workflowRunId?: string;
  status?: string;
  finished?: boolean;
}): void {
  const db = openDb();
  const stmt = db.prepare(
    'INSERT INTO step_attempts (id, workflow_run_id, step_name, status, finished_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < input.count; i += 1) {
    stmt.run(
      `attempt-${input.stepName ?? 'archive-ledger'}-${input.status ?? 'running'}-${i}-${Math.random()}`,
      input.workflowRunId ?? 'run-1',
      input.stepName ?? 'archive-ledger',
      input.status ?? 'running',
      input.finished ? '2026-07-28T00:00:00.000Z' : null,
    );
  }
  db.close();
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-replay-guard-'));
  process.env.LUMOS_DATA_DIR = dataDir;
});

afterEach(() => {
  if (originalDataDir === undefined) {
    delete process.env.LUMOS_DATA_DIR;
  } else {
    process.env.LUMOS_DATA_DIR = originalDataDir;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('assertNoReplayStorm', () => {
  it('库还没建时放行(单测/首次运行没有重放历史)', () => {
    expect(() => assertNoReplayStorm(runtime())).not.toThrow();
  });

  it('正常路径只有当前这一条 running,不熔断', () => {
    createSchema();
    seedAttempts({ count: 1 });
    expect(() => assertNoReplayStorm(runtime())).not.toThrow();
  });

  it('刚好到上限还放行,超过一条才熔断', () => {
    createSchema();
    seedAttempts({ count: MAX_STEP_EXECUTIONS_PER_RUN });
    expect(() => assertNoReplayStorm(runtime())).not.toThrow();

    seedAttempts({ count: 1 });
    expect(() => assertNoReplayStorm(runtime())).toThrow(WorkflowReplayStormError);
  });

  it('熔断错误标了 nonRetryable,不会再被 step 级重试吃一轮', () => {
    createSchema();
    seedAttempts({ count: MAX_STEP_EXECUTIONS_PER_RUN + 1 });

    try {
      assertNoReplayStorm(runtime());
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowReplayStormError);
      expect((error as WorkflowReplayStormError).nonRetryable).toBe(true);
      expect((error as WorkflowReplayStormError).stepId).toBe('archive-ledger');
    }
  });

  it('错误信息点名步骤并说清同步阻塞这个成因(用户在 UI 上看的就是它)', () => {
    createSchema();
    seedAttempts({ count: MAX_STEP_EXECUTIONS_PER_RUN + 1 });

    expect(() => assertNoReplayStorm(runtime())).toThrow(/archive-ledger/);
    expect(() => assertNoReplayStorm(runtime())).toThrow(/execFileSync/);
  });

  it('已写回终态的记录不算数(finished_at 有值)', () => {
    createSchema();
    seedAttempts({ count: 50, status: 'completed', finished: true });
    seedAttempts({ count: 1 });
    expect(() => assertNoReplayStorm(runtime())).not.toThrow();
  });

  it('只数本 run 本步骤的,别的步骤和别的 run 不串味', () => {
    createSchema();
    seedAttempts({ count: 20, stepName: 'pick-material' });
    seedAttempts({ count: 20, workflowRunId: 'run-2' });
    seedAttempts({ count: 1 });

    expect(() => assertNoReplayStorm(runtime())).not.toThrow();
  });

  it('runtime 缺字段时放行,不拿守卫去挡正常业务', () => {
    expect(() => assertNoReplayStorm(undefined)).not.toThrow();
    expect(() => assertNoReplayStorm({ stepId: 'x' } as WorkflowStepRuntimeContext)).not.toThrow();
  });
});
