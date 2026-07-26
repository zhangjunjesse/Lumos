// 运行工作区路径约定回归。
//
// 这套算法是读写配对的:写入端(agent/team 落 trace 与产出)和读取端(详情页 collectRunLiveTraces)
// 必须算出同一个目录,差一个字符详情页就什么都读不到。历史上被逐字节复制了 4 份,
// 现已收敛到 run-workspace-paths;这里锁住行为,防止将来任一处漂移。

import path from 'path';
import os from 'os';
import {
  getWorkflowAgentRootDir,
  resolveRunWorkspace,
  resolveStageWorkspace,
  sanitizePathSegment,
} from '../run-workspace-paths';

const ORIGINAL_DATA_DIR = process.env.LUMOS_DATA_DIR;

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.LUMOS_DATA_DIR;
  else process.env.LUMOS_DATA_DIR = ORIGINAL_DATA_DIR;
});

describe('getWorkflowAgentRootDir', () => {
  it('跟随 LUMOS_DATA_DIR', () => {
    process.env.LUMOS_DATA_DIR = '/tmp/lumos-test';
    expect(getWorkflowAgentRootDir()).toBe(path.join('/tmp/lumos-test', 'workflow-agent-runs'));
  });

  it('没设时回落到 ~/.lumos', () => {
    delete process.env.LUMOS_DATA_DIR;
    delete process.env.CLAUDE_GUI_DATA_DIR;
    expect(getWorkflowAgentRootDir()).toBe(path.join(os.homedir(), '.lumos', 'workflow-agent-runs'));
  });
});

describe('sanitizePathSegment', () => {
  it('常见 id 原样保留 —— 详情页把目录名直接当 stepId,不能被改写', () => {
    expect(sanitizePathSegment('print-team', 'x')).toBe('print-team');
    expect(sanitizePathSegment('step_1', 'x')).toBe('step_1');
    // UUID 形式的 run id 也必须不变,否则读写对不上
    expect(sanitizePathSegment('7f3a1b2c-4d5e-6789-abcd-ef0123456789', 'x'))
      .toBe('7f3a1b2c-4d5e-6789-abcd-ef0123456789');
  });

  it('非法字符替成连字符,首尾连字符去掉', () => {
    expect(sanitizePathSegment('a/b\\c:d', 'x')).toBe('a-b-c-d');
    expect(sanitizePathSegment('  ..步骤..  ', 'x')).toBe('步骤'.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'x');
  });

  it('全非法或空时用 fallback', () => {
    expect(sanitizePathSegment('///', 'fallback')).toBe('fallback');
    expect(sanitizePathSegment('   ', 'fallback')).toBe('fallback');
  });

  it('截断到 80 字符', () => {
    expect(sanitizePathSegment('a'.repeat(200), 'x')).toHaveLength(80);
  });
});

describe('resolveStageWorkspace', () => {
  it('目录形状 = <root>/<runId>/stages/<stepId>,与 collectRunLiveTraces 的遍历假设一致', () => {
    process.env.LUMOS_DATA_DIR = '/tmp/lumos-test';
    expect(resolveStageWorkspace('run-1', 'print-team')).toBe(
      path.join('/tmp/lumos-test', 'workflow-agent-runs', 'run-1', 'stages', 'print-team'),
    );
  });

  it('run 目录与 stage 目录同源(stage 一定在 run 之下)', () => {
    process.env.LUMOS_DATA_DIR = '/tmp/lumos-test';
    const run = resolveRunWorkspace('run-1');
    expect(resolveStageWorkspace('run-1', 'step-a').startsWith(run)).toBe(true);
  });

  it('team 与 agent 对同一个 (runId, stepId) 算出同一目录 —— 这是读写能对上的前提', () => {
    process.env.LUMOS_DATA_DIR = '/tmp/lumos-test';
    // agent 侧历史写法:sanitize 后手工拼接
    const agentStyle = path.join(
      getWorkflowAgentRootDir(),
      sanitizePathSegment('run-1', 'workflow-run'),
      'stages',
      sanitizePathSegment('print-team', 'agent-step'),
    );
    expect(resolveStageWorkspace('run-1', 'print-team', 'team-step')).toBe(agentStyle);
  });
});
