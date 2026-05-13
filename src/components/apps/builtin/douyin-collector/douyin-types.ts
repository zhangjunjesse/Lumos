export type DouyinCollectorTab =
  | 'overview'
  | 'collect'
  | 'library'
  | 'organize'
  | 'automations'
  | 'im'
  | 'settings';

export interface DouyinCollectorStatus {
  app?: {
    id: string;
    name: string;
    version: string;
    source: string;
    category?: string;
    status: string;
  };
  install?: {
    installed: boolean;
    version: string | null;
    error: string | null;
  };
  auth?: {
    ready: boolean;
    cookieValid: boolean;
    lastCheckedAt: string | null;
    lastOkAt?: string | null;
  };
  sources?: {
    creators: number;
    keywords: number;
    creatorsEnabled?: number;
    keywordsEnabled?: number;
    hasActiveSchedule?: boolean;
  };
  queue?: {
    runningJobs: number;
    pendingJobs: number;
    lastRunAt: string | null;
    lastPatrolAt?: string | null;
    lastRunFailure: string | null;
  };
  library?: {
    videos: number;
    unprocessed?: number;
    drafts: number;
    published: number;
    discarded?: number;
    lastPublishedAt?: string | null;
  };
  transcribe?: {
    speechProviderConfigured: boolean;
    cloudLoggedIn: boolean;
    asrReady: boolean;
  };
  asrSpend?: {
    totalAmount: number;
    videoCount: number;
    last30dAmount: number;
    last30dVideoCount: number;
  };
  ready?: boolean;
  phase?: string;
}
