export interface WeChatReport {
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
