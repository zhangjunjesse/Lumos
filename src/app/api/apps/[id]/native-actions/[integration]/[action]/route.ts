import { type NextRequest, NextResponse } from 'next/server';

import { sendGoofishDraftFromApp, syncGoofishIntoApp } from '@/lib/app/goofish-app-sync';
import { rejectGoofishDraftFromApp } from '@/lib/app/goofish-draft-control';
import { generateGoofishReplyDraft } from '@/lib/app/goofish-reply-draft-generator';
import type { AppManifest } from '@/lib/app/manifest/types';
import { runNativeAppAutomation } from '@/lib/app/native-automation-runner';
import { syncNativeAppAutomationSchedule } from '@/lib/app/native-automation-scheduler';
import { runNativeAppCommand } from '@/lib/app/native-command-runner';
import { recordNativeInstallSelfCheck } from '@/lib/app/native-install-self-check';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; integration: string; action: string }> },
): Promise<NextResponse> {
  const { id, integration, action } = await context.params;
  try {
    const installed = readInstalledApp(id);
    if (!installed) {
      return NextResponse.json({ ok: false, message: '应用未安装。' }, { status: 404 });
    }
    const { manifest } = installed;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (integration === 'goofish' && action === 'sync') {
      const svc = getAppPlatformService();
      const result = await syncGoofishIntoApp({
        manifest,
        store: createAppDataStore(svc.db, id),
        options: {
          fetchNum: numberOption(body.fetchNum),
          watchSecs: numberOption(body.watchSecs),
          messageLimit: numberOption(body.messageLimit),
          sessionLimit: numberOption(body.sessionLimit),
          messagesPerChat: numberOption(body.messagesPerChat),
        },
      });
      return NextResponse.json(result);
    }
    if (integration === 'goofish' && action === 'send-draft') {
      const svc = getAppPlatformService();
      const rowId = typeof body.rowId === 'string' ? body.rowId : '';
      if (!rowId) {
        return NextResponse.json(
          { ok: false, message: '缺少要发送的草稿行 ID。' },
          { status: 400 },
        );
      }
      const result = await sendGoofishDraftFromApp({
        manifest,
        store: createAppDataStore(svc.db, id),
        rowId,
        confirmed: body.confirmed === true,
      });
      return NextResponse.json(result);
    }
    if (integration === 'goofish' && action === 'generate-reply-draft') {
      const svc = getAppPlatformService();
      const rowId = typeof body.rowId === 'string' ? body.rowId : '';
      if (!rowId) {
        return NextResponse.json(
          { ok: false, message: '缺少要生成草稿的买家会话行 ID。' },
          { status: 400 },
        );
      }
      const result = await generateGoofishReplyDraft({
        manifest,
        store: createAppDataStore(svc.db, id),
        rowId,
      });
      return NextResponse.json(result);
    }
    if (integration === 'goofish' && action === 'reject-draft') {
      const svc = getAppPlatformService();
      const rowId = typeof body.rowId === 'string' ? body.rowId : '';
      if (!rowId) {
        return NextResponse.json(
          { ok: false, message: '缺少要拒绝的草稿行 ID。' },
          { status: 400 },
        );
      }
      const result = rejectGoofishDraftFromApp({
        manifest,
        store: createAppDataStore(svc.db, id),
        rowId,
        confirmed: body.confirmed === true,
      });
      return NextResponse.json(result);
    }
    if (integration === 'app' && action === 'run-automation') {
      const svc = getAppPlatformService();
      const rowId = typeof body.rowId === 'string' ? body.rowId : '';
      if (!rowId) {
        return NextResponse.json(
          { ok: false, message: '缺少要运行的自动化行 ID。' },
          { status: 400 },
        );
      }
      const result = await runNativeAppAutomation({
        manifest,
        store: createAppDataStore(svc.db, id),
        rowId,
        confirmed: body.confirmed === true,
      });
      return NextResponse.json(result);
    }
    if (integration === 'app' && action === 'run-self-check') {
      const svc = getAppPlatformService();
      const result = recordNativeInstallSelfCheck(svc.db, {
        appId: id,
        installPath: installed.installPath,
      });
      return NextResponse.json({
        ok: result.status === 'success',
        message: result.summary,
        ...result,
      });
    }
    if (integration === 'app' && action === 'run-command') {
      const svc = getAppPlatformService();
      const rowId = typeof body.rowId === 'string' ? body.rowId : '';
      if (!rowId) {
        return NextResponse.json(
          { ok: false, message: '缺少要执行的命令模板行 ID。' },
          { status: 400 },
        );
      }
      const result = await runNativeAppCommand({
        manifest,
        store: createAppDataStore(svc.db, id),
        rowId,
        confirmed: body.confirmed === true,
      });
      return NextResponse.json(result);
    }
    if (integration === 'app' && action === 'sync-automation-schedule') {
      const svc = getAppPlatformService();
      const rowId = typeof body.rowId === 'string' ? body.rowId : '';
      if (!rowId) {
        return NextResponse.json(
          { ok: false, message: '缺少要同步定时任务的自动化行 ID。' },
          { status: 400 },
        );
      }
      const result = await syncNativeAppAutomationSchedule({
        appId: id,
        manifest,
        store: createAppDataStore(svc.db, id),
        rowId,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { ok: false, message: `不支持的原生应用动作：${integration}:${action}` },
      { status: 404 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

function readInstalledApp(appId: string): { manifest: AppManifest; installPath: string } | null {
  const svc = getAppPlatformService();
  const row = svc.db
    .prepare('SELECT manifest_json, install_path FROM lumos_app_apps WHERE id = ?')
    .get(appId) as { manifest_json: string; install_path: string } | undefined;
  if (!row) return null;
  return {
    manifest: JSON.parse(row.manifest_json) as AppManifest,
    installPath: row.install_path,
  };
}

function numberOption(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
