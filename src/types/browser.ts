/**
 * Browser API Types
 */

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

export type BrowserDisplayTarget = 'default' | 'panel' | 'hidden';

export type BrowserEventName =
  | 'tab-created'
  | 'tab-closed'
  | 'tab-switched'
  | 'tab-loaded'
  | 'tab-loading'
  | 'tab-url-updated'
  | 'tab-title-updated'
  | 'tab-favicon-updated'
  | 'tab-error'
  | 'share-to-ai'
  | 'download-created'
  | 'download-updated'
  | 'ai-activity'
  | 'context-updated'
  | 'capture-settings-updated'
  | 'recording-updated'
  | 'workflows-updated';

export interface BrowserAiActivity {
  id: string;
  action: string;
  status: 'running' | 'success' | 'error';
  details?: string;
  pageId?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface BrowserPanelTabData {
  pageId?: string;
  url?: string;
  fitWidth?: boolean;
  isLoading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface BrowserOpenRequest {
  url: string;
  pageId?: string;
}

export interface BrowserCaptureSettings {
  enabled: boolean;
  paused: boolean;
  retentionDays: number;
  maxEvents: number;
}

export interface BrowserContextEvent {
  id?: number;
  tabId?: string;
  pageId?: string;
  type:
    | 'tab'
    | 'navigation'
    | 'load'
    | 'error'
    | 'download'
    | 'capture'
    | 'workflow'
    | 'ai';
  summary: string;
  url?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export type BrowserWorkflowStepType =
  | 'navigate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'click'
  | 'input'
  | 'keypress'
  | 'wait'
  | 'screenshot';

export interface BrowserWorkflowParameter {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
  secret?: boolean;
  description?: string;
}

export interface BrowserWorkflowStep {
  id: string;
  type: BrowserWorkflowStepType;
  label: string;
  selector?: string;
  text?: string;
  url?: string;
  value?: string;
  paramRef?: string;
  waitForText?: string;
  timeoutMs?: number;
  screenshotName?: string;
  key?: string;
  metadata?: Record<string, unknown>;
}

export interface BrowserWorkflow {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  sourceTabId?: string;
  startUrl?: string;
  parameters: BrowserWorkflowParameter[];
  steps: BrowserWorkflowStep[];
}

export interface BrowserRecordingState {
  isRecording: boolean;
  tabId?: string;
  workflowName?: string;
  startedAt?: number;
  stepCount: number;
}

export interface BrowserWorkflowRunResult {
  runId: string;
  workflowId: string;
  status: 'running' | 'success' | 'error';
  finalUrl: string;
  downloadedFiles: string[];
  screenshots: string[];
  extractedData: Record<string, unknown>;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface BrowserAPIResponse {
  success: boolean;
  error?: string;
}

export interface CreateTabResponse extends BrowserAPIResponse {
  tabId?: string;
}

export interface GetTabsResponse extends BrowserAPIResponse {
  tabs?: BrowserTab[];
  activeTabId?: string | null;
}

export interface GetCookiesResponse extends BrowserAPIResponse {
  cookies?: Electron.Cookie[];
}

export interface SendCDPCommandResponse extends BrowserAPIResponse {
  result?: unknown;
}

export interface IsCDPConnectedResponse extends BrowserAPIResponse {
  connected?: boolean;
}

export interface BrowserBridgeConfigResponse extends BrowserAPIResponse {
  url?: string;
  token?: string;
}

export interface GetContextEventsResponse extends BrowserAPIResponse {
  events?: BrowserContextEvent[];
}

export interface GetCaptureSettingsResponse extends BrowserAPIResponse {
  settings?: BrowserCaptureSettings;
}

export interface GetRecordingStateResponse extends BrowserAPIResponse {
  recording?: BrowserRecordingState;
}

export interface GetWorkflowsResponse extends BrowserAPIResponse {
  workflows?: BrowserWorkflow[];
}

export interface BrowserWorkflowResponse extends BrowserAPIResponse {
  workflow?: BrowserWorkflow;
}

export interface BrowserWorkflowRunResponse extends BrowserAPIResponse {
  result?: BrowserWorkflowRunResult;
}

export interface BrowserAPI {
  createTab: (url?: string) => Promise<CreateTabResponse>;
  closeTab: (tabId: string) => Promise<BrowserAPIResponse>;
  switchTab: (tabId: string) => Promise<BrowserAPIResponse>;
  getTabs: () => Promise<GetTabsResponse>;
  navigate: (tabId: string, url: string, timeout?: number) => Promise<BrowserAPIResponse>;
  goBack: (tabId: string) => Promise<BrowserAPIResponse>;
  goForward: (tabId: string) => Promise<BrowserAPIResponse>;
  reload: (tabId: string) => Promise<BrowserAPIResponse>;
  stop: (tabId: string) => Promise<BrowserAPIResponse>;
  setZoomFactor: (tabId: string, zoomFactor: number) => Promise<BrowserAPIResponse>;
  getCookies: (filter?: Electron.CookiesGetFilter) => Promise<GetCookiesResponse>;
  setCookie: (cookie: Electron.CookiesSetDetails) => Promise<BrowserAPIResponse>;
  connectCDP: (tabId: string) => Promise<BrowserAPIResponse>;
  disconnectCDP: (tabId: string) => Promise<BrowserAPIResponse>;
  sendCDPCommand: (tabId: string, method: string, params?: Record<string, unknown>) => Promise<SendCDPCommandResponse>;
  isCDPConnected: (tabId: string) => Promise<IsCDPConnectedResponse>;
  setDisplayTarget: (
    target: BrowserDisplayTarget,
    bounds?: { x: number; y: number; width: number; height: number },
  ) => Promise<BrowserAPIResponse>;
  getBridgeConfig: () => Promise<BrowserBridgeConfigResponse>;
  getContextEvents: (options?: { limit?: number; tabId?: string }) => Promise<GetContextEventsResponse>;
  clearContextEvents: () => Promise<BrowserAPIResponse>;
  getCaptureSettings: () => Promise<GetCaptureSettingsResponse>;
  updateCaptureSettings: (settings: Partial<BrowserCaptureSettings>) => Promise<GetCaptureSettingsResponse>;
  startRecording: (options?: { tabId?: string; workflowName?: string }) => Promise<GetRecordingStateResponse>;
  stopRecording: (options?: { save?: boolean; workflowName?: string }) => Promise<BrowserWorkflowResponse>;
  cancelRecording: () => Promise<GetRecordingStateResponse>;
  getRecordingState: () => Promise<GetRecordingStateResponse>;
  getWorkflows: () => Promise<GetWorkflowsResponse>;
  saveWorkflow: (workflow: BrowserWorkflow) => Promise<BrowserWorkflowResponse>;
  deleteWorkflow: (workflowId: string) => Promise<BrowserAPIResponse>;
  replayWorkflow: (workflowId: string, options?: { tabId?: string; parameters?: Record<string, string> }) => Promise<BrowserWorkflowRunResponse>;
  onEvent: (callback: (event: BrowserEventName, data: unknown) => void) => () => void;
  onOpenInContentTab: (callback: (payload: BrowserOpenRequest) => void) => () => void;
}

export {};
