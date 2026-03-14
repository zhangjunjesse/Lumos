'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  CirclePause,
  CirclePlay,
  Download,
  ExternalLink,
  FileDown,
  History,
  Loader2,
  Radar,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  type BrowserAiActivity,
  type BrowserCaptureSettings,
  type BrowserContextEvent,
  type BrowserRecordingState,
  type BrowserTab,
  type BrowserWorkflow,
  type BrowserWorkflowParameter,
  type BrowserWorkflowRunResult,
} from '@/types/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserTabBar } from './BrowserTabBar';
import { BrowserCompactToolbar } from './BrowserCompactToolbar';
import { AIActivityBanner } from './AIActivityBanner';
import { BrowserStatusBar } from './BrowserStatusBar';
import { BrowserSidePanel } from './BrowserSidePanel';
import type { URLSuggestion } from './URLAutocomplete';

const CHAT_DRAFT_STORAGE_KEY = 'lumos.chat.draft';
const CHAT_DRAFT_EVENT = 'lumos:chat-draft';

const DEFAULT_CAPTURE_SETTINGS: BrowserCaptureSettings = {
  enabled: true,
  paused: false,
  retentionDays: 7,
  maxEvents: 600,
};

interface DownloadEntry {
  id: string;
  fileName: string;
  path: string;
  state: string;
  done: boolean;
  tabId?: string;
  receivedBytes?: number;
  totalBytes?: number;
}

type ContextScope = 'active' | 'all';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBrowserInput(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return null;

  const schemePattern = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
  const hostPattern = /^[^\s/]+\.[^\s/]+/;
  const localhostPattern = /^localhost(?::\d+)?(?:\/.*)?$/i;
  const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/;

  if (schemePattern.test(value)) {
    return value;
  }

  if (localhostPattern.test(value) || ipv4Pattern.test(value)) {
    return `http://${value}`;
  }

  if (hostPattern.test(value) && !value.includes(' ')) {
    return `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function getTabLabel(tab: BrowserTab | null | undefined, noTabText: string, newTabText: string): string {
  if (!tab) return noTabText;

  const title = tab.title.trim();
  if (title) {
    return title;
  }

  try {
    const parsed = new URL(tab.url);
    return parsed.hostname.replace(/^www\./, '') || newTabText;
  } catch {
    return newTabText;
  }
}

function formatTimestamp(timestamp: number | undefined, justNowText: string): string {
  if (!timestamp) return justNowText;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function pickEventColor(type: BrowserContextEvent['type']): string {
  switch (type) {
    case 'error':
      return 'bg-rose-500';
    case 'download':
      return 'bg-amber-500';
    case 'workflow':
      return 'bg-violet-500';
    case 'ai':
      return 'bg-sky-500';
    case 'capture':
      return 'bg-emerald-500';
    default:
      return 'bg-muted-foreground';
  }
}

function buildWorkflowPrompt(workflow: BrowserWorkflow, translations: {
  refineWorkflow: string;
  requirements: string;
  currentWorkflowJson: string;
}): string {
  return [
    translations.refineWorkflow,
    translations.requirements,
    '1. Make the workflow more reliable for replay.',
    '2. Keep secrets as parameters instead of inline values.',
    '3. Suggest where wait or screenshot steps should be added.',
    '4. Return a revised JSON object matching the Lumos workflow schema only.',
    '',
    translations.currentWorkflowJson,
    '```json',
    JSON.stringify(workflow, null, 2),
    '```',
  ].join('\n');
}

function buildSharePrompt(type: 'text' | 'link' | 'image', content: string, useAsContextText: string): string {
  return [
    `I shared ${type} content from the built-in browser.`,
    useAsContextText,
    '',
    content,
  ].join('\n');
}

function saveChatDraft(prompt: string): void {
  const payload = { text: prompt, mode: 'replace', createdAt: Date.now() };
  sessionStorage.setItem(CHAT_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(CHAT_DRAFT_EVENT, { detail: payload }));
}

function isDownloadPayload(
  payload: unknown,
): payload is {
  fileName: string;
  path: string;
  state?: string;
  done?: boolean;
  tabId?: string;
  receivedBytes?: number;
  totalBytes?: number;
} {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { fileName?: unknown }).fileName === 'string'
    && typeof (payload as { path?: unknown }).path === 'string';
}

function isErrorPayload(payload: unknown): payload is { tabId: string; errorDescription: string } {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { tabId?: unknown }).tabId === 'string'
    && typeof (payload as { errorDescription?: unknown }).errorDescription === 'string';
}

function isTabPayload(payload: unknown): payload is { tabId: string } {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { tabId?: unknown }).tabId === 'string';
}

function isRecordingPayload(payload: unknown): payload is BrowserRecordingState {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { isRecording?: unknown }).isRecording === 'boolean'
    && typeof (payload as { stepCount?: unknown }).stepCount === 'number';
}

function isCaptureSettingsPayload(payload: unknown): payload is { settings: BrowserCaptureSettings } {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { settings?: { enabled?: unknown } }).settings?.enabled === 'boolean';
}

function isAiActivityPayload(payload: unknown): payload is BrowserAiActivity {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { id?: unknown }).id === 'string'
    && typeof (payload as { action?: unknown }).action === 'string'
    && typeof (payload as { status?: unknown }).status === 'string';
}

function isSharePayload(payload: unknown): payload is { content: string; type: 'text' | 'link' | 'image' } {
  return typeof payload === 'object' && payload !== null
    && typeof (payload as { content?: unknown }).content === 'string'
    && ['text', 'link', 'image'].includes(String((payload as { type?: unknown }).type));
}

export interface BrowserProps {
  className?: string;
}

export function Browser({ className }: BrowserProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const browserHostRef = useRef<HTMLDivElement | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const [captureSettings, setCaptureSettings] = useState<BrowserCaptureSettings>(DEFAULT_CAPTURE_SETTINGS);
  const [contextEvents, setContextEvents] = useState<BrowserContextEvent[]>([]);
  const [recording, setRecording] = useState<BrowserRecordingState>({ isRecording: false, stepCount: 0 });
  const [workflows, setWorkflows] = useState<BrowserWorkflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [replayResult, setReplayResult] = useState<BrowserWorkflowRunResult | null>(null);
  const [replayingWorkflowId, setReplayingWorkflowId] = useState<string | null>(null);
  const [aiActivity, setAiActivity] = useState<BrowserAiActivity | null>(null);
  const [tabErrors, setTabErrors] = useState<Record<string, string>>({});
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [contextScope, setContextScope] = useState<ContextScope>('active');
  const [openPanel, setOpenPanel] = useState<'context' | 'workflows' | 'downloads' | null>(null);

  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.browser);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const activeError = activeTabId ? tabErrors[activeTabId] : null;
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) || null;

  const urlSuggestions = useMemo<URLSuggestion[]>(
    () => tabs.map((tab) => ({
      value: tab.url,
      label: getTabLabel(tab, t('browser.noTabSelected'), t('browser.newTab')),
      meta: tab.url,
    })),
    [tabs],
  );

  const loadTabs = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.getTabs) return;

    const result = await api.getTabs();
    if (!result.success || !Array.isArray(result.tabs)) {
      return;
    }

    setTabs(result.tabs);
    setActiveTabId(result.activeTabId || result.tabs[0]?.id || null);
  }, []);

  const loadCaptureSettings = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.getCaptureSettings) return;

    const result = await api.getCaptureSettings();
    if (result.success && result.settings) {
      setCaptureSettings(result.settings);
    }
  }, []);

  const loadContextEvents = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.getContextEvents) return;

    const result = await api.getContextEvents(
      contextScope === 'active' && activeTabId ? { limit: 80, tabId: activeTabId } : { limit: 80 },
    );
    if (result.success && Array.isArray(result.events)) {
      setContextEvents(result.events);
    }
  }, [activeTabId, contextScope]);

  const loadRecordingState = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.getRecordingState) return;

    const result = await api.getRecordingState();
    if (result.success && result.recording) {
      setRecording(result.recording);
    }
  }, []);

  const loadWorkflows = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.getWorkflows) return;

    const result = await api.getWorkflows();
    if (result.success && Array.isArray(result.workflows)) {
      const workflows = result.workflows;
      setWorkflows(workflows);
      setSelectedWorkflowId((current) => {
        if (current && workflows.some((workflow) => workflow.id === current)) {
          return current;
        }
        return workflows[0]?.id || null;
      });
    }
  }, []);

  useEffect(() => {
    if (!activeTab) {
      return;
    }
    setUrlValue(activeTab.url || '');
  }, [activeTab]);

  useEffect(() => {
    if (!isElectron) {
      return;
    }

    void Promise.all([
      loadTabs(),
      loadCaptureSettings(),
      loadContextEvents(),
      loadRecordingState(),
      loadWorkflows(),
    ]);

    const unsubscribe = window.electronAPI?.browser?.onEvent?.((eventName, payload) => {
      if (
        eventName === 'tab-created'
        || eventName === 'tab-closed'
        || eventName === 'tab-switched'
        || eventName === 'tab-loaded'
        || eventName === 'tab-loading'
        || eventName === 'tab-url-updated'
        || eventName === 'tab-title-updated'
        || eventName === 'tab-favicon-updated'
        || eventName === 'tab-error'
      ) {
        void loadTabs();
      }

      if ((eventName === 'tab-loading' || eventName === 'tab-loaded' || eventName === 'tab-closed') && isTabPayload(payload)) {
        setTabErrors((current) => {
          if (!current[payload.tabId]) {
            return current;
          }
          const next = { ...current };
          delete next[payload.tabId];
          return next;
        });
      }

      if (eventName === 'tab-error' && isErrorPayload(payload)) {
        setTabErrors((current) => ({ ...current, [payload.tabId]: payload.errorDescription }));
      }

      if (eventName === 'tab-loaded' || eventName === 'tab-loading') {
        void loadContextEvents();
      }

      if (eventName === 'context-updated') {
        void loadContextEvents();
      }

      if (eventName === 'capture-settings-updated') {
        if (isCaptureSettingsPayload(payload)) {
          setCaptureSettings(payload.settings);
        } else {
          void loadCaptureSettings();
        }
      }

      if (eventName === 'recording-updated') {
        if (isRecordingPayload(payload)) {
          setRecording(payload);
        } else {
          void loadRecordingState();
        }
      }

      if (eventName === 'workflows-updated') {
        void loadWorkflows();
      }

      if (eventName === 'download-created' || eventName === 'download-updated') {
        if (isDownloadPayload(payload)) {
          setDownloads((current) => {
            const existing = current.find((entry) => entry.path === payload.path);
            const next: DownloadEntry = {
              id: existing?.id || createId('download'),
              fileName: payload.fileName,
              path: payload.path,
              state: payload.state || (eventName === 'download-created' ? 'started' : 'updated'),
              done: Boolean(payload.done) || payload.state === 'completed',
              tabId: payload.tabId,
              receivedBytes: payload.receivedBytes,
              totalBytes: payload.totalBytes,
            };

            if (!existing) {
              return [next, ...current].slice(0, 12);
            }

            return current.map((entry) => (entry.id === existing.id ? next : entry));
          });
        }
      }

      if (eventName === 'ai-activity' && isAiActivityPayload(payload)) {
        setAiActivity(payload);
      }

      if (eventName === 'share-to-ai' && isSharePayload(payload)) {
        saveChatDraft(buildSharePrompt(payload.type, payload.content, t('browser.useAsContext')));
        router.push('/chat');
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [
    isElectron,
    loadCaptureSettings,
    loadContextEvents,
    loadRecordingState,
    loadTabs,
    loadWorkflows,
    router,
  ]);

  useEffect(() => {
    if (!isElectron) {
      return;
    }
    void loadContextEvents();
  }, [activeTabId, contextScope, isElectron, loadContextEvents]);

  useEffect(() => {
    if (!aiActivity || aiActivity.status === 'running') {
      return;
    }

    const timer = window.setTimeout(() => {
      setAiActivity((current) => (current?.id === aiActivity.id ? null : current));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [aiActivity]);

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.setDisplayTarget) {
      return;
    }

    if (!activeTabId || !browserHostRef.current) {
      void api.setDisplayTarget('hidden');
      return;
    }

    const syncBounds = () => {
      const rect = browserHostRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 2 || rect.height < 2) {
        void api.setDisplayTarget('hidden');
        return;
      }

      void api.setDisplayTarget('panel', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    syncBounds();
    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(browserHostRef.current);
    window.addEventListener('resize', syncBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
      void api.setDisplayTarget('hidden');
    };
  }, [activeTabId, isElectron]);

  useEffect(() => {
    if (!activeTabId || !window.electronAPI?.browser?.switchTab) {
      return;
    }
    void window.electronAPI.browser.switchTab(activeTabId);
  }, [activeTabId]);

  const openPromptInChat = useCallback((prompt: string) => {
    saveChatDraft(prompt);
    router.push('/chat');
  }, [router]);

  const handleCreateTab = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.createTab) return;

    const result = await api.createTab('about:blank');
    if (!result.success || !result.tabId) {
      return;
    }

    await api.switchTab(result.tabId);
    await loadTabs();
  }, [loadTabs]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    const api = window.electronAPI?.browser;
    if (!api?.switchTab) return;

    // 立即更新 UI，不等待后端响应
    setActiveTabId(tabId);

    const result = await api.switchTab(tabId);
    if (!result.success) {
      // 如果失败，重新加载正确的状态
      await loadTabs();
    }
  }, [loadTabs]);

  const handleCloseTab = useCallback(async (tabId: string) => {
    const api = window.electronAPI?.browser;
    if (!api?.closeTab) return;

    const result = await api.closeTab(tabId);
    if (!result.success) {
      return;
    }

    setTabErrors((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    await loadTabs();
  }, [loadTabs]);

  const handleNavigate = useCallback(async (nextValue: string) => {
    const api = window.electronAPI?.browser;
    if (!api?.navigate || !api.createTab) {
      return;
    }

    const normalized = normalizeBrowserInput(nextValue);
    if (!normalized) return;

    setUrlValue(normalized);

    if (!activeTabId) {
      const created = await api.createTab(normalized);
      if (created.success && created.tabId) {
        await api.switchTab(created.tabId);
        await loadTabs();
      }
      return;
    }

    const result = await api.navigate(activeTabId, normalized);
    if (result.success) {
      setTabErrors((current) => {
        const next = { ...current };
        delete next[activeTabId];
        return next;
      });
      await loadTabs();
    }
  }, [activeTabId, loadTabs]);

  const handleBack = useCallback(async () => {
    if (!activeTabId) return;
    const result = await window.electronAPI?.browser?.goBack?.(activeTabId);
    if (result?.success) {
      await loadTabs();
    }
  }, [activeTabId, loadTabs]);

  const handleForward = useCallback(async () => {
    if (!activeTabId) return;
    const result = await window.electronAPI?.browser?.goForward?.(activeTabId);
    if (result?.success) {
      await loadTabs();
    }
  }, [activeTabId, loadTabs]);

  const handleReload = useCallback(async () => {
    if (!activeTabId) return;
    const result = await window.electronAPI?.browser?.reload?.(activeTabId);
    if (result?.success) {
      await loadTabs();
    }
  }, [activeTabId, loadTabs]);

  const handleStop = useCallback(async () => {
    if (!activeTabId) return;
    await window.electronAPI?.browser?.stop?.(activeTabId);
    await loadTabs();
  }, [activeTabId, loadTabs]);

  const handleCaptureSettingUpdate = useCallback(async (patch: Partial<BrowserCaptureSettings>) => {
    const api = window.electronAPI?.browser;
    if (!api?.updateCaptureSettings) return;

    const result = await api.updateCaptureSettings(patch);
    if (result.success && result.settings) {
      setCaptureSettings(result.settings);
    }
  }, []);

  const handleClearContext = useCallback(async () => {
    await window.electronAPI?.browser?.clearContextEvents?.();
    await loadContextEvents();
  }, [loadContextEvents]);

  const handleStartRecording = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.startRecording) return;

    const result = await api.startRecording({
      tabId: activeTabId || undefined,
      workflowName: `${getTabLabel(activeTab, t('browser.noTabSelected'), t('browser.newTab'))} workflow`,
    });

    if (result.success && result.recording) {
      setRecording(result.recording);
    }
  }, [activeTab, activeTabId]);

  const handleStopRecording = useCallback(async (save: boolean) => {
    const api = window.electronAPI?.browser;
    if (!api) return;

    const result = save
      ? await api.stopRecording()
      : await api.stopRecording({ save: false });

    if (save && result.success && result.workflow) {
      setSelectedWorkflowId(result.workflow.id);
    }

    await loadRecordingState();
    await loadWorkflows();
  }, [loadRecordingState, loadWorkflows]);

  const handleCancelRecording = useCallback(async () => {
    const result = await window.electronAPI?.browser?.cancelRecording?.();
    if (result?.success && result.recording) {
      setRecording(result.recording);
    } else {
      await loadRecordingState();
    }
  }, [loadRecordingState]);

  const handleReplayWorkflow = useCallback(async (workflow: BrowserWorkflow) => {
    const api = window.electronAPI?.browser;
    if (!api?.replayWorkflow) return;

    setReplayingWorkflowId(workflow.id);
    try {
      const result = await api.replayWorkflow(workflow.id, {
        tabId: activeTabId || undefined,
        parameters: parameterValues,
      });
      if (result.success && result.result) {
        setReplayResult(result.result);
      }
    } finally {
      setReplayingWorkflowId(null);
    }
  }, [activeTabId, parameterValues]);

  const handleDeleteWorkflow = useCallback(async (workflowId: string) => {
    const api = window.electronAPI?.browser;
    if (!api?.deleteWorkflow) return;

    const result = await api.deleteWorkflow(workflowId);
    if (result.success) {
      setReplayResult((current) => (current?.workflowId === workflowId ? null : current));
      await loadWorkflows();
    }
  }, [loadWorkflows]);

  const handleAddScreenshotStep = useCallback(async (workflow: BrowserWorkflow) => {
    const api = window.electronAPI?.browser;
    if (!api?.saveWorkflow) return;

    const updatedWorkflow: BrowserWorkflow = {
      ...workflow,
      updatedAt: Date.now(),
      steps: [
        ...workflow.steps,
        {
          id: createId('wf-step'),
          type: 'screenshot',
          label: t('browser.captureResultPage'),
          screenshotName: `${workflow.name.toLowerCase().replace(/\s+/g, '-')}-result`,
        },
      ],
    };

    const result = await api.saveWorkflow(updatedWorkflow);
    if (result.success && result.workflow) {
      setSelectedWorkflowId(result.workflow.id);
      await loadWorkflows();
    }
  }, [loadWorkflows]);

  const handleOpenDownload = useCallback(async (download: DownloadEntry) => {
    await window.electronAPI?.shell?.openPath(download.path);
  }, []);

  const activeWorkflowParameters = selectedWorkflow?.parameters || [];
  const completedDownloads = downloads.filter((entry) => entry.done);

  if (!isElectron) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-muted/20 p-8', className)}>
        <div className="max-w-lg rounded-[28px] border border-border/60 bg-background p-10 shadow-sm">
          <div className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Browser Workspace
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">The built-in browser is only available in Electron.</h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Open Lumos as a desktop app to use the shared native page runtime, browser bridge, context capture,
            and workflow replay.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.12),_transparent_18%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.96))]',
        className,
      )}
    >
      <AIActivityBanner activity={aiActivity} onDismiss={() => setAiActivity(null)} />

      <BrowserCompactToolbar
        tabs={tabs}
        activeTabId={activeTabId}
        urlValue={urlValue}
        isLoading={Boolean(activeTab?.isLoading)}
        suggestions={urlSuggestions}
        onUrlChange={setUrlValue}
        onNavigate={handleNavigate}
        onCreateTab={handleCreateTab}
        onSwitchTab={handleSwitchTab}
        onCloseTab={handleCloseTab}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onStop={handleStop}
        onOpenPanel={setOpenPanel}
      />

      <div className={cn("min-h-0 flex-1 transition-all duration-300", openPanel && "pr-[420px]")}>
        <section className="relative h-full overflow-hidden bg-card">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.02),rgba(15,23,42,0.04))]" />
            <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full bg-background/80 px-3 py-1 text-xs">
                Shared page runtime
              </Badge>
              {recording.isRecording && (
                <Badge className="rounded-full bg-rose-500 px-3 py-1 text-xs text-white">
                  Recording {recording.stepCount} step{recording.stepCount === 1 ? '' : 's'}
                </Badge>
              )}
              {aiActivity?.status === 'running' && (
                <Badge className="rounded-full bg-sky-500 px-3 py-1 text-xs text-white">
                  AI is controlling the page
                </Badge>
              )}
            </div>

            <div ref={browserHostRef} className="absolute inset-0" />

            {!activeTab && (
              <div className="absolute inset-0 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                  <div className="mb-3 inline-flex rounded-full bg-sky-500/10 p-3 text-sky-700">
                    <Radar className="size-6" />
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight">Open a native browser tab</h2>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    This workspace shares the same real page instance across manual browsing, the browser bridge,
                    and workflow replay.
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Button onClick={handleCreateTab}>Create tab</Button>
                    <Button variant="outline" onClick={() => handleNavigate(urlValue || 'https://www.google.com')}>
                      Open a site
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab && activeTab.isLoading && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-sky-100">
                <div className="h-full w-1/3 animate-[pulse_1.1s_ease-in-out_infinite] rounded-full bg-sky-500" />
              </div>
            )}

            {activeTab && activeTab.isLoading && (
              <div className="pointer-events-none absolute bottom-4 left-4 z-10 inline-flex items-center gap-2 rounded-full bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm">
                <Loader2 className="size-3.5 animate-spin" />
                Loading {getTabLabel(activeTab, t('browser.noTabSelected'), t('browser.newTab'))}
              </div>
            )}

            {activeTab && activeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/88 p-8 backdrop-blur-sm">
                <div className="max-w-md rounded-[24px] border border-rose-200 bg-rose-50/90 p-6 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                    <Bot className="size-4" />
                    Page load failed
                  </div>
                  <p className="mt-3 text-sm leading-6 text-rose-900/80">{activeError}</p>
                  <div className="mt-5 flex gap-2">
                    <Button size="sm" onClick={handleReload}>
                      Retry
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleNavigate(activeTab.url)}>
                      Open again
                    </Button>
                  </div>
                </div>
              </div>
            )}
        </section>
      </div>

      <BrowserStatusBar
        aiActivity={aiActivity}
        downloads={downloads}
        captureEnabled={captureSettings.enabled}
        capturePaused={captureSettings.paused}
        onOpenPanel={setOpenPanel}
      />

      <BrowserSidePanel
        open={openPanel}
        onOpenChange={setOpenPanel}
        contextContent={<div>Context content placeholder</div>}
        workflowsContent={<div>Workflows content placeholder</div>}
        downloadsContent={<div>Downloads content placeholder</div>}
      />
    </div>
  );
}
