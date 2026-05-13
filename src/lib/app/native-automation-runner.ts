import type Database from 'better-sqlite3';

import {
  isGoofishNativeApp,
  syncGoofishIntoApp,
  type GoofishAppSyncDeps,
} from './goofish-app-sync';
import { scanAndReply } from './goofish-auto-reply-matcher';
import { scanAndNotify } from './goofish-reminder-engine';
import type { AppManifest } from './manifest/types';
import type { AppDataStore } from './runtime/data-store';

export interface NativeAppAutomationRunResult {
  ok: boolean;
  automationId: string;
  runId: string;
  message: string;
  nativeAction?: string;
  error?: string;
}

export interface NativeAppAutomationRunnerDeps {
  now?: () => number;
  goofish?: Partial<GoofishAppSyncDeps>;
}

interface AppAutomationRow extends Record<string, unknown> {
  title?: string;
  enabled?: boolean;
  schedule?: string;
  description?: string;
  native_action?: string;
  last_status?: 'not_connected' | 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  last_run_summary?: string;
  last_run_id?: string;
  updated_at?: string;
}

export const SUPPORTED_NATIVE_AUTOMATION_ACTIONS = new Set([
  'goofish:sync',
  'goofish:auto-reply-scan',
  'goofish:check-reminders',
  'douyin-collector:patrol-creators',
  'douyin-collector:patrol-keywords',
]);

export async function runNativeAppAutomation(input: {
  manifest: AppManifest;
  store: AppDataStore;
  rowId: string;
  confirmed: boolean;
  db?: Database.Database;
  appId?: string;
  deps?: NativeAppAutomationRunnerDeps;
}): Promise<NativeAppAutomationRunResult> {
  const now = input.deps?.now?.() ?? Date.now();
  const updatedAt = new Date(now).toISOString();
  const automation = input.store.get<AppAutomationRow>('app_automations', input.rowId);

  const fail = (
    message: string,
    opts: { runId?: string; nativeAction?: string; updateAutomation?: boolean } = {},
  ): NativeAppAutomationRunResult => {
    const runId = opts.runId ?? createRunHistory(input.store, {
      title: automation?.title ? `运行自动化：${automation.title}` : '运行应用自动化',
      status: 'failed',
      summary: message,
      failure_reason: message,
      updated_at: updatedAt,
    }).id;
    if (automation && opts.updateAutomation !== false) {
      input.store.update<AppAutomationRow>('app_automations', automation.id, {
        last_status: 'failed',
        last_run_summary: message,
        last_run_id: runId,
        updated_at: updatedAt,
      });
    }
    return {
      ok: false,
      automationId: input.rowId,
      runId,
      message,
      nativeAction: opts.nativeAction,
      error: message,
    };
  };

  if (!input.confirmed) {
    return fail('立即运行应用自动化前必须由用户在界面明确确认。');
  }
  if (!automation) {
    return fail('找不到要运行的应用自动化。', { updateAutomation: false });
  }
  if (automation.enabled !== true) {
    return fail('这条自动化未启用，请先开启后再运行。');
  }

  const nativeAction = resolveNativeAppAutomationAction(input.manifest, automation);
  if (!nativeAction) {
    return fail('这条自动化没有绑定可执行动作；请先填写执行动作，例如 goofish:sync。');
  }
  if (!SUPPORTED_NATIVE_AUTOMATION_ACTIONS.has(nativeAction)) {
    return fail(`当前应用自动化运行桥尚未接入动作：${nativeAction}`, { nativeAction });
  }

  input.store.update<AppAutomationRow>('app_automations', automation.id, {
    last_status: 'running',
    last_run_summary: `正在运行 ${nativeAction}。`,
    updated_at: updatedAt,
  });

  if (nativeAction === 'goofish:sync') {
    if (!isGoofishNativeApp(input.manifest)) {
      return fail('当前应用不是闲鱼类应用，不能运行 goofish:sync 自动化。', { nativeAction });
    }
    const result = await syncGoofishIntoApp({
      manifest: input.manifest,
      store: input.store,
      deps: input.deps?.goofish,
    });
    const status = result.ok ? 'success' : 'failed';
    input.store.update<AppAutomationRow>('app_automations', automation.id, {
      last_status: status,
      last_run_summary: result.message,
      last_run_id: result.runId,
      updated_at: updatedAt,
    });
    return {
      ok: result.ok,
      automationId: automation.id,
      runId: result.runId,
      message: result.message,
      nativeAction,
      error: result.error,
    };
  }

  if (nativeAction === 'goofish:auto-reply-scan') {
    if (!isGoofishNativeApp(input.manifest)) {
      return fail('当前应用不是闲鱼类应用，不能运行 goofish:auto-reply-scan。', { nativeAction });
    }
    const result = await scanAndReply({
      manifest: input.manifest,
      store: input.store,
      now,
    });
    const summary = `白名单扫描：命中 ${result.matched}，发送 ${result.sent}，草稿 ${result.drafted}，频控降级 ${result.throttled}${result.errors.length ? `，错误 ${result.errors.length}` : ''}。`;
    const status = result.ok ? 'success' : 'failed';
    input.store.update<AppAutomationRow>('app_automations', automation.id, {
      last_status: status,
      last_run_summary: summary,
      last_run_id: result.runId,
      updated_at: updatedAt,
    });
    return {
      ok: result.ok,
      automationId: automation.id,
      runId: result.runId,
      message: summary,
      nativeAction,
      error: result.errors.map((e) => `${e.conversationId}: ${e.reason}`).join('; ') || undefined,
    };
  }

  if (nativeAction === 'goofish:check-reminders') {
    if (!isGoofishNativeApp(input.manifest)) {
      return fail('当前应用不是闲鱼类应用，不能运行 goofish:check-reminders。', { nativeAction });
    }
    const result = await scanAndNotify({
      manifest: input.manifest,
      store: input.store,
      now,
      db: input.db,
      appId: input.appId,
    });
    const summary = `提醒扫描：触发 ${result.triggered.length}，跳过 ${result.skipped}${result.errors.length ? `，错误 ${result.errors.length}` : ''}。`;
    const allFailed = result.triggered.length === 0 && result.errors.length > 0;
    const status = allFailed ? 'failed' : 'success';
    const runId = result.runId ?? createRunHistory(input.store, {
      title: `运行自动化：${automation.title ?? nativeAction}`,
      status,
      summary,
      failure_reason: result.errors.map((e) => `${e.ruleId}: ${e.reason}`).join('; ') || undefined,
      updated_at: updatedAt,
    }).id;
    input.store.update<AppAutomationRow>('app_automations', automation.id, {
      last_status: status,
      last_run_summary: summary,
      last_run_id: runId,
      updated_at: updatedAt,
    });
    return {
      ok: !allFailed,
      automationId: automation.id,
      runId,
      message: summary,
      nativeAction,
      error: result.errors.map((e) => `${e.ruleId}: ${e.reason}`).join('; ') || undefined,
    };
  }

  if (
    nativeAction === 'douyin-collector:patrol-creators' ||
    nativeAction === 'douyin-collector:patrol-keywords'
  ) {
    if (input.manifest.id !== 'douyin-collector') {
      return fail(
        '当前应用不是抖音采集器，不能运行 douyin-collector 自动化。',
        { nativeAction },
      );
    }
    const { patrolEnabledCreators, patrolEnabledKeywords } = await import(
      '@/lib/douyin-collector/patrol'
    );
    const report =
      nativeAction === 'douyin-collector:patrol-creators'
        ? await patrolEnabledCreators()
        : await patrolEnabledKeywords();
    const status = report.ok ? 'success' : 'failed';
    const runId = createRunHistory(input.store, {
      title: `运行自动化：${automation.title ?? nativeAction}`,
      status,
      summary: report.message,
      failure_reason: status === 'failed' ? report.reasons.join('；') || undefined : undefined,
      updated_at: updatedAt,
    }).id;
    input.store.update<AppAutomationRow>('app_automations', automation.id, {
      last_status: status,
      last_run_summary: report.message,
      last_run_id: runId,
      updated_at: updatedAt,
    });
    return {
      ok: report.ok,
      automationId: automation.id,
      runId,
      message: report.message,
      nativeAction,
      error: status === 'failed' ? report.reasons.join('；') || undefined : undefined,
    };
  }

  return fail(`当前应用自动化运行桥尚未接入动作：${nativeAction}`, { nativeAction });
}

export function resolveNativeAppAutomationAction(
  manifest: AppManifest,
  automation: Pick<AppAutomationRow, 'title' | 'description' | 'schedule' | 'native_action'>,
): string | null {
  const configured = normalizeNativeAction(automation.native_action);
  if (configured) return configured;

  const text = [
    automation.title,
    automation.description,
    automation.schedule,
  ].filter(Boolean).join('\n');
  if (isGoofishNativeApp(manifest) && /(同步|sync)/i.test(text)) {
    return 'goofish:sync';
  }
  return null;
}

function normalizeNativeAction(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}:[a-z][a-z0-9-]{0,63}$/.test(trimmed)) return null;
  return trimmed;
}

function createRunHistory(
  store: AppDataStore,
  row: {
    title: string;
    status: 'running' | 'success' | 'failed' | 'cancelled';
    summary: string;
    failure_reason?: string;
    updated_at: string;
  },
) {
  return store.create('run_history', row);
}
