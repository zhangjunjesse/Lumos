import { NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { getAuthStatus } from '@/lib/x-platform/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Status snapshot for X 雷达 builtin app.
 * 只读真实数据，禁止 mock：未登录就显示未登录，没装就显示未装，没任务就 0。
 */
export async function GET() {
  let installedVersion: string | null = null;
  let xLoggedIn = false;
  let xScreenName = '';
  let tasks = 0;
  let monitorTasks = 0;
  let topicTasks = 0;
  let digestTasks = 0;
  let statsTasks = 0;
  let alerts = 0;
  let reports = 0;
  let digests = 0;
  let statsReports = 0;
  let error: string | null = null;

  try {
    const auth = await getAuthStatus().catch(() => null);
    xLoggedIn = !!auth?.loggedIn;
    xScreenName = auth?.screenName ?? '';
  } catch (err) {
    // 不阻塞——auth 拿不到照样显示其他状态
    error = err instanceof Error ? err.message : String(err);
  }

  try {
    const svc = getAppPlatformService();
    const row = svc.db
      .prepare('SELECT version FROM lumos_app_apps WHERE id = ?')
      .get('x-radar') as { version: string } | undefined;
    installedVersion = row?.version ?? null;

    if (installedVersion) {
      const store = createAppDataStore(svc.db, 'x-radar');
      const taskRows = store.query<{ kind?: string; enabled?: boolean }>('radar_tasks', { limit: 1000 });
      tasks = taskRows.length;
      // P2 修：4 个字段语义统一为「该 kind 全部任务数」而不是「enabled-only 计数」。
      // 卡片显示「3 任务」更直观；要看启用情况进任务详情看 enabled badge。
      monitorTasks = taskRows.filter((t) => t.kind === 'monitor').length;
      topicTasks = taskRows.filter((t) => t.kind === 'topic').length;
      digestTasks = taskRows.filter((t) => t.kind === 'digest').length;
      statsTasks = taskRows.filter((t) => t.kind === 'stats').length;
      alerts = store.count('radar_alerts');
      reports = store.count('topic_reports');
      digests = store.count('follow_digests');
      statsReports = store.count('stats_reports');

      // 4 个 patrol 对应的 app_automations rowId（前端用 app:run-automation 调用时需要）
      const autoRows = store.query<{ native_action?: string }>('app_automations', { limit: 100 });
      const findId = (action: string) =>
        autoRows.find((r) => (r.native_action ?? '') === action)?.id ?? null;
      const automations = {
        monitor: findId('x-radar:run-monitor-tasks'),
        topic: findId('x-radar:run-topic-tasks'),
        digest: findId('x-radar:run-digest-tasks'),
        stats: findId('x-radar:run-stats-tasks'),
      };

      return NextResponse.json({
        app: { id: 'x-radar', name: 'X 雷达', version: installedVersion },
        install: { installed: true, version: installedVersion },
        x: { loggedIn: xLoggedIn, screenName: xScreenName },
        tasks: { total: tasks, monitor: monitorTasks, topic: topicTasks, digest: digestTasks, stats: statsTasks },
        library: { alerts, reports, digests, stats: statsReports },
        automations,
        ready: xLoggedIn && tasks > 0,
        phase: !xLoggedIn ? '需登录 X' : tasks === 0 ? '未创建任务' : '就绪',
        error,
      });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // 未安装的兜底分支（installedVersion=null 时走到这里）
  return NextResponse.json({
    install: { installed: false, version: null },
    x: { loggedIn: xLoggedIn, screenName: xScreenName },
    tasks: { total: 0, monitor: 0, topic: 0, digest: 0, stats: 0 },
    library: { alerts: 0, reports: 0, digests: 0, stats: 0 },
    automations: { monitor: null, topic: null, digest: null, stats: null },
    ready: false,
    phase: '未安装',
    error,
  });
}
