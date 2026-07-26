// 工作流运行工作区的路径约定 —— 单一真源。
//
// 这套算法是**读写配对**的:写入端(agent / team 步骤落 trace 与产出)和读取端
// (详情页收集 live trace、产出文件、输入快照)必须算出完全相同的目录,差一个字符就
// 读不到。历史上这两个函数被逐字节复制了 4 份(subagent / code-executor /
// schedule-run-detail / schedule-run-rerun-artifacts),任何一份改动都会静默切断读写。
// 新增使用者一律 import 这里,不要再抄。
//
// 目录形状:<dataDir>/workflow-agent-runs/<safeRunId>/stages/<safeStepId>/
// 详情页的 collectRunLiveTraces 把 stages 下的目录名直接当 stepId,所以 safeStepId
// 必须与 UI 侧的 stepId 一致(sanitize 只替换非法字符,常见的 kebab-case id 原样保留)。

import os from 'os';
import path from 'path';

export function getWorkflowAgentRootDir(): string {
  const baseDir = process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
  return path.join(baseDir, 'workflow-agent-runs');
}

export function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

/** 一次运行的根目录。 */
export function resolveRunWorkspace(workflowRunId: string): string {
  return path.join(getWorkflowAgentRootDir(), sanitizePathSegment(workflowRunId, 'workflow-run'));
}

/** 某一步的工作区(trace 文件与产出都落在这里下面)。 */
export function resolveStageWorkspace(workflowRunId: string, stepId: string, fallback = 'step'): string {
  return path.join(resolveRunWorkspace(workflowRunId), 'stages', sanitizePathSegment(stepId, fallback));
}
