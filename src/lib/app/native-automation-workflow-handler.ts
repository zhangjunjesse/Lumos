import {
  getCodeHandler,
  registerCodeHandler,
} from '@/lib/workflow/code-handler-registry';
import type { CodeHandlerContext } from '@/lib/workflow/code-handler-types';
import type { StepResult } from '@/lib/workflow/types';

import type { AppManifest } from './manifest/types';
import { runNativeAppAutomation } from './native-automation-runner';
import { createAppDataStore } from './runtime/data-store';
import { getAppPlatformService } from './service';

const HANDLER_ID = 'native-app.run-automation';

export function registerNativeAppAutomationWorkflowHandler(): void {
  if (getCodeHandler(HANDLER_ID)) return;
  registerCodeHandler({
    id: HANDLER_ID,
    name: '应用自动化运行器',
    description: '在 Workflow 定时任务中运行受控用户生成应用自动化。',
    execute: runNativeAppAutomationHandler,
  });
}

registerNativeAppAutomationWorkflowHandler();

async function runNativeAppAutomationHandler(ctx: CodeHandlerContext): Promise<StepResult> {
  const appId = normalizeParam(ctx.params.appId);
  const automationId = normalizeParam(ctx.params.automationId);
  if (!appId || !automationId) {
    return failed('应用自动化 handler 缺少 appId 或 automationId。');
  }
  if (ctx.signal?.aborted) {
    return failed('应用自动化运行已取消。');
  }

  const svc = getAppPlatformService();
  const row = svc.db
    .prepare('SELECT manifest_json, enabled FROM lumos_app_apps WHERE id = ?')
    .get(appId) as { manifest_json: string; enabled: number } | undefined;
  if (!row) {
    return failed(`应用未安装：${appId}`);
  }
  if (row.enabled !== 1) {
    return failed(`应用已停用：${appId}`);
  }

  let manifest: AppManifest;
  try {
    manifest = JSON.parse(row.manifest_json) as AppManifest;
  } catch (error) {
    return failed(`应用 manifest 损坏：${error instanceof Error ? error.message : String(error)}`);
  }

  const result = await runNativeAppAutomation({
    manifest,
    store: createAppDataStore(svc.db, appId),
    rowId: automationId,
    confirmed: true,
    db: svc.db,
    appId,
  });

  const output = {
    summary: result.message,
    appId,
    automationId,
    runId: result.runId,
    nativeAction: result.nativeAction ?? normalizeParam(ctx.params.nativeAction) ?? '',
  };
  return {
    success: result.ok,
    output,
    error: result.error,
    metadata: {
      appId,
      automationId,
      runId: result.runId,
      nativeAction: output.nativeAction,
    },
  };
}

function failed(message: string): StepResult {
  return {
    success: false,
    output: { summary: message },
    error: message,
  };
}

function normalizeParam(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
