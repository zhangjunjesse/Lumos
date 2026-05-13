import { NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Status snapshot for the Deep Research built-in app.
 *
 * Honest signals only — counts come from the app data store. We do NOT
 * synthesize "ready" from inferred capabilities, because users can fail
 * each SOP stage on its own merits (clarify, plan, collect, etc.).
 */
export async function GET() {
  let installedVersion: string | null = null;
  let installError: string | null = null;
  let tasks = 0;
  let activeTasks = 0;
  let pausedTasks = 0;
  let deliveredTasks = 0;
  let evidenceCount = 0;
  let reportCount = 0;
  let failedTasks = 0;

  try {
    const svc = getAppPlatformService();
    const row = svc.db
      .prepare('SELECT version FROM lumos_app_apps WHERE id = ?')
      .get('deep-research') as { version: string } | undefined;
    installedVersion = row?.version ?? null;

    if (installedVersion) {
      const store = createAppDataStore(svc.db, 'deep-research');
      const taskRows = store.query<{ status?: string }>('research_tasks', { limit: 1000 });
      tasks = taskRows.length;
      activeTasks = taskRows.filter((r) => r.status === 'active').length;
      pausedTasks = taskRows.filter((r) => r.status === 'paused').length;
      deliveredTasks = taskRows.filter((r) => r.status === 'delivered').length;
      failedTasks = taskRows.filter((r) => r.status === 'failed').length;
      evidenceCount = store.query('research_evidence', { limit: 1 }).length === 0
        ? 0
        : store.query('research_evidence', { limit: 10000 }).length;
      reportCount = store.query('research_reports', { limit: 10000 }).length;
    }
  } catch (err) {
    installError = err instanceof Error ? err.message : String(err);
  }

  const installed = installedVersion !== null;
  const phase = !installed
    ? 'needs-install'
    : failedTasks > 0
      ? 'failed'
      : activeTasks > 0
        ? 'syncing'
        : tasks === 0
          ? 'not_configured'
          : 'ready';
  const ready = phase === 'ready' || phase === 'syncing';

  return NextResponse.json({
    app: {
      id: 'deep-research',
      name: '深度调研',
      version: installedVersion ?? '0.0.1',
      source: 'builtin',
      category: 'research',
      status: phase,
    },
    install: {
      installed,
      version: installedVersion,
      error: installError,
    },
    tasks: {
      total: tasks,
      active: activeTasks,
      paused: pausedTasks,
      delivered: deliveredTasks,
      failed: failedTasks,
    },
    library: {
      evidence: evidenceCount,
      reports: reportCount,
    },
    ready,
    phase,
  });
}
