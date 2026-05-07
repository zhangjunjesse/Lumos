import { getRunHistory, listRunHistory } from '@/lib/db/scheduled-workflows';
import { getScheduleRunDetail } from '@/lib/workflow/schedule-run-detail';

import { listWeChatAutomations } from './automations';
import {
  archiveWeChatAutomationReport,
  isArchivedWeChatAutomationReportDeleted,
  listArchivedWeChatAutomationReports,
  type WeChatArchivedReport,
} from './report-archive';

const REPORTS_PER_AUTOMATION = 5;
const REPORTS_TOTAL_LIMIT = 20;

export interface WeChatAutomationReport {
  id: string;
  automationId: string;
  automationName: string;
  scheduleId: string;
  runId: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  summary: string;
  error: string;
  reportMarkdown: string;
  searchText: string;
  reportFileName: string | null;
  detailAvailable: boolean;
}

interface LiveWeChatAutomationReport extends WeChatAutomationReport {
  archiveReportMarkdown: string;
}

export async function listWeChatAutomationReports(): Promise<WeChatAutomationReport[]> {
  const automations = listWeChatAutomations();
  const liveReports: WeChatAutomationReport[] = [];
  for (const automation of automations) {
    if (!automation.scheduleId) continue;
    let runs: ReturnType<typeof listRunHistory>;
    try {
      runs = listRunHistory(automation.scheduleId, REPORTS_PER_AUTOMATION);
    } catch (error) {
      console.warn('[wechat-assistant] Failed to list schedule run history for reports:', error);
      continue;
    }
    for (const run of runs) {
      let detail: Awaited<ReturnType<typeof getScheduleRunDetail>>;
      try {
        detail = await getScheduleRunDetail(run.id, automation.scheduleId);
      } catch (error) {
        console.warn('[wechat-assistant] Failed to load schedule run detail for report:', error);
        continue;
      }
      if (!detail) continue;
      const liveReport = buildLiveReport(automation, detail);
      if (isArchivedWeChatAutomationReportDeleted(liveReport.id)) continue;
      const { archiveReportMarkdown, ...report } = liveReport;
      liveReports.push(report);
      try {
        archiveWeChatAutomationReport({
          ...report,
          reportMarkdown: archiveReportMarkdown,
        });
      } catch {
        // Listing recent results must still work even if archival storage is temporarily locked.
      }
    }
  }

  const reportsById = new Map<string, WeChatAutomationReport>();
  for (const report of listArchivedWeChatAutomationReports(REPORTS_TOTAL_LIMIT)) {
    reportsById.set(report.id, buildReportFromArchive(report));
  }
  for (const report of liveReports) {
    reportsById.set(report.id, report);
  }

  return [...reportsById.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, REPORTS_TOTAL_LIMIT);
}

function buildLiveReport(
  automation: ReturnType<typeof listWeChatAutomations>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getScheduleRunDetail>>>,
): LiveWeChatAutomationReport {
  const reportFile = detail.outputFiles.find((file) => file.name.endsWith('wechat-daily-summary.md'))
    ?? detail.outputFiles.find((file) => file.mimeType === 'text/markdown' || file.name.endsWith('.md'))
    ?? null;
  const fullReportMarkdown = reportFile?.content?.trim() ?? '';
  const summary = cleanSummary(
    detail.stepOverlays.generate_report?.outputSummary
      || firstOverlaySummary(detail.stepOverlays)
      || fullReportMarkdown
      || detail.run.error
      || '暂无摘要',
  );
  return {
    id: detail.run.id,
    automationId: automation.id,
    automationName: automation.name,
    scheduleId: automation.scheduleId!,
    runId: detail.run.id,
    status: detail.run.status,
    startedAt: detail.run.startedAt,
    completedAt: detail.run.completedAt,
    summary,
    error: detail.run.error,
    reportMarkdown: fullReportMarkdown ? trimReport(fullReportMarkdown) : '',
    searchText: fullReportMarkdown,
    archiveReportMarkdown: fullReportMarkdown,
    reportFileName: reportFile?.name ?? null,
    detailAvailable: true,
  };
}

function buildReportFromArchive(report: WeChatArchivedReport): WeChatAutomationReport {
  return {
    id: report.id,
    automationId: report.automationId,
    automationName: report.automationName,
    scheduleId: report.scheduleId,
    runId: report.runId,
    status: report.status,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    summary: report.summary,
    error: report.error,
    reportMarkdown: trimReport(report.reportMarkdown),
    searchText: report.reportMarkdown,
    reportFileName: report.reportFileName,
    detailAvailable: Boolean(report.runId && getRunHistory(report.runId)),
  };
}

function firstOverlaySummary(overlays: Record<string, { outputSummary?: string }>): string {
  for (const overlay of Object.values(overlays)) {
    if (overlay.outputSummary?.trim()) return overlay.outputSummary;
  }
  return '';
}

function cleanSummary(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function trimReport(value: string): string {
  return value.trim().slice(0, 3000);
}
