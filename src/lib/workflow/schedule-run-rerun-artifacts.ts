import { cp, mkdir, stat } from 'fs/promises';
import path from 'path';
import { getWorkflowAgentRootDir, sanitizePathSegment } from './run-workspace-paths';

export interface CopyReusedStepOutputArtifactsResult {
  copiedStepIds: string[];
  warnings: string[];
}

export async function copyReusedStepOutputArtifacts(input: {
  sourceWorkflowRunId: string;
  targetWorkflowRunId: string;
  stepIds: string[];
}): Promise<CopyReusedStepOutputArtifactsResult> {
  const result: CopyReusedStepOutputArtifactsResult = {
    copiedStepIds: [],
    warnings: [],
  };
  if (input.stepIds.length === 0) return result;
  const sourceRunDir = getWorkflowRunWorkspaceDir(input.sourceWorkflowRunId);
  const targetRunDir = getWorkflowRunWorkspaceDir(input.targetWorkflowRunId);
  for (const stepId of input.stepIds) {
    const safeStepId = sanitizePathSegment(stepId, 'step');
    const sourceOutputDir = path.join(sourceRunDir, 'stages', safeStepId, 'output');
    if (!await dirExists(sourceOutputDir)) continue;
    const targetOutputDir = path.join(targetRunDir, 'stages', safeStepId, 'output');
    try {
      await mkdir(path.dirname(targetOutputDir), { recursive: true });
      await cp(sourceOutputDir, targetOutputDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
      result.copiedStepIds.push(stepId);
    } catch (error) {
      result.warnings.push(
        `复制复用节点「${stepId}」产物失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}

function getWorkflowRunWorkspaceDir(workflowRunId: string): string {
  return path.join(getWorkflowAgentRootDir(), sanitizePathSegment(workflowRunId, 'workflow-run'));
}

async function dirExists(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}
