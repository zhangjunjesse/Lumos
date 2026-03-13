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
import { AIActivityBanner } from './AIActivityBanner';
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

    const result = await api.switchTab(tabId);
    if (!result.success) {
      return;
    }
    setActiveTabId(tabId);
  }, []);

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

      <BrowserToolbar
        activeTab={activeTab || undefined}
        urlValue={urlValue}
        isLoading={Boolean(activeTab?.isLoading)}
        suggestions={urlSuggestions}
        onUrlChange={setUrlValue}
        onNavigate={handleNavigate}
        onCreateTab={handleCreateTab}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onStop={handleStop}
      />

      <BrowserTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={handleSwitchTab}
        onCloseTab={handleCloseTab}
        onCreateTab={handleCreateTab}
      />

      <div className="min-h-0 flex-1 p-4">
        <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="relative min-h-[420px] overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
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

          <aside className="min-h-0 overflow-hidden rounded-[28px] border border-border/70 bg-card/95 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <Tabs defaultValue="context" className="h-full min-h-0">
              <div className="border-b border-border/60 px-4 pb-3 pt-4">
                <div className="mb-3">
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t('browser.browserOps')}
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight">{getTabLabel(activeTab, t('browser.noTabSelected'), t('browser.newTab'))}</div>
                </div>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="context">{t('browser.context')}</TabsTrigger>
                  <TabsTrigger value="workflows">{t('browser.workflows')}</TabsTrigger>
                  <TabsTrigger value="downloads">{t('browser.downloads')}</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="context" className="min-h-0">
                <ScrollArea className="h-full">
                  <div className="space-y-6 p-4">
                    <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">{t('browser.captureControls')}</div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t('browser.captureControlsDesc')}
                          </p>
                        </div>
                        <Switch
                          checked={captureSettings.enabled}
                          onCheckedChange={(checked) => void handleCaptureSettingUpdate({ enabled: checked })}
                        />
                      </div>

                      <Separator className="my-4" />

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">{t('browser.pauseCapture')}</div>
                            <div className="text-xs text-muted-foreground">{t('browser.pauseCaptureDesc')}</div>
                          </div>
                          <Switch
                            checked={captureSettings.paused}
                            disabled={!captureSettings.enabled}
                            onCheckedChange={(checked) => void handleCaptureSettingUpdate({ paused: checked })}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">{t('browser.retentionDays')}</span>
                            <Input
                              type="number"
                              min={1}
                              value={captureSettings.retentionDays}
                              onChange={(event) => {
                                const next = Number(event.target.value);
                                if (Number.isFinite(next)) {
                                  void handleCaptureSettingUpdate({ retentionDays: Math.max(1, Math.floor(next)) });
                                }
                              }}
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">{t('browser.maxEvents')}</span>
                            <Input
                              type="number"
                              min={50}
                              step={50}
                              value={captureSettings.maxEvents}
                              onChange={(event) => {
                                const next = Number(event.target.value);
                                if (Number.isFinite(next)) {
                                  void handleCaptureSettingUpdate({ maxEvents: Math.max(50, Math.floor(next)) });
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{t('browser.capturedActivity')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t('browser.capturedActivityDesc')}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleClearContext}>
                          <Trash2 className="size-4" />
                          {t('browser.clear')}
                        </Button>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <Button
                          variant={contextScope === 'active' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setContextScope('active')}
                        >
                          {t('browser.currentPage')}
                        </Button>
                        <Button
                          variant={contextScope === 'all' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setContextScope('all')}
                        >
                          {t('browser.allTabs')}
                        </Button>
                      </div>

                      <div className="mt-4 space-y-3">
                        {contextEvents.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                            {t('browser.noEvents')}
                          </div>
                        )}

                        {contextEvents.map((event) => (
                          <div key={event.id || `${event.type}-${event.createdAt}`} className="flex gap-3 rounded-2xl border border-border/50 bg-muted/25 p-3">
                            <div className={cn('mt-1 size-2.5 rounded-full', pickEventColor(event.type))} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <div className="truncate text-sm font-medium">{event.summary}</div>
                                <div className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                  {event.type}
                                </div>
                              </div>
                              {event.url && (
                                <div className="mt-1 truncate text-xs text-muted-foreground">{event.url}</div>
                              )}
                              <div className="mt-2 text-[11px] text-muted-foreground">{formatTimestamp(event.createdAt, t('browser.justNow'))}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="workflows" className="min-h-0">
                <ScrollArea className="h-full">
                  <div className="space-y-6 p-4">
                    <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">{t('browser.workflowRecorder')}</div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t('browser.workflowRecorderDesc')}
                          </p>
                        </div>
                        {recording.isRecording ? (
                          <Badge className="rounded-full bg-rose-500 text-white">
                            {t('browser.live')}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-full">{t('browser.idle')}</Badge>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {!recording.isRecording ? (
                          <Button onClick={handleStartRecording}>
                            <CirclePlay className="size-4" />
                            {t('browser.startRecording')}
                          </Button>
                        ) : (
                          <>
                            <Button onClick={() => void handleStopRecording(true)}>
                              <CirclePause className="size-4" />
                              {t('browser.saveRecording')}
                            </Button>
                            <Button variant="outline" onClick={() => void handleStopRecording(false)}>
                              {t('browser.stopWithoutSaving')}
                            </Button>
                            <Button variant="ghost" onClick={handleCancelRecording}>
                              {t('browser.cancel')}
                            </Button>
                          </>
                        )}
                      </div>

                      {recording.isRecording && (
                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900/80">
                          {t('browser.recordingOn')} <strong>{recording.tabId}</strong> {t('browser.with')} {recording.stepCount} {recording.stepCount === 1 ? t('browser.capturedStep') : t('browser.capturedSteps')}.
                        </div>
                      )}
                    </section>

                    <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{t('browser.savedWorkflows')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t('browser.savedWorkflowsDesc')}
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-full">{workflows.length}</Badge>
                      </div>

                      <div className="mt-4 space-y-3">
                        {workflows.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                            {t('browser.noWorkflows')}
                          </div>
                        )}

                        {workflows.map((workflow) => (
                          <button
                            key={workflow.id}
                            type="button"
                            className={cn(
                              'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                              workflow.id === selectedWorkflowId
                                ? 'border-sky-300 bg-sky-50/70'
                                : 'border-border/60 bg-background hover:border-sky-200 hover:bg-sky-50/40',
                            )}
                            onClick={() => setSelectedWorkflowId(workflow.id)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{workflow.name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {workflow.steps.length} {workflow.steps.length === 1 ? t('browser.step') : t('browser.stepsPlural')} · {t('browser.updated')} {formatTimestamp(workflow.updatedAt, t('browser.justNow'))}
                                </div>
                              </div>
                              <Wand2 className="size-4 text-muted-foreground" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>

                    {selectedWorkflow && (
                      <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold">{selectedWorkflow.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {selectedWorkflow.description || t('browser.noDescription')}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openPromptInChat(buildWorkflowPrompt(selectedWorkflow, { refineWorkflow: t('browser.refineWorkflow'), requirements: t('browser.requirements'), currentWorkflowJson: t('browser.currentWorkflowJson') }))}
                            >
                              <Sparkles className="size-4" />
                              {t('browser.askAi')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleAddScreenshotStep(selectedWorkflow)}
                            >
                              <FileDown className="size-4" />
                              {t('browser.addScreenshot')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleDeleteWorkflow(selectedWorkflow.id)}
                            >
                              <Trash2 className="size-4" />
                              {t('browser.delete')}
                            </Button>
                          </div>
                        </div>

                        {activeWorkflowParameters.length > 0 && (
                          <div className="mt-4 space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {t('browser.replayParameters')}
                            </div>
                            {activeWorkflowParameters.map((parameter: BrowserWorkflowParameter) => (
                              <label key={parameter.id} className="block space-y-1.5">
                                <span className="text-sm font-medium">
                                  {parameter.label}
                                  {parameter.required && ' *'}
                                </span>
                                <Input
                                  type={parameter.secret ? 'password' : 'text'}
                                  value={parameterValues[parameter.name] ?? parameter.defaultValue ?? ''}
                                  placeholder={parameter.description || parameter.name}
                                  onChange={(event) =>
                                    setParameterValues((current) => ({
                                      ...current,
                                      [parameter.name]: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        )}

                        <div className="mt-5 flex flex-wrap gap-2">
                          <Button
                            onClick={() => void handleReplayWorkflow(selectedWorkflow)}
                            disabled={replayingWorkflowId === selectedWorkflow.id}
                          >
                            {replayingWorkflowId === selectedWorkflow.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                            {t('browser.replayWorkflow')}
                          </Button>
                        </div>

                        <div className="mt-5 space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {t('browser.steps')}
                          </div>
                          <div className="space-y-2">
                            {selectedWorkflow.steps.map((step) => (
                              <div key={step.id} className="rounded-2xl border border-border/50 bg-muted/20 px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-medium">{step.label}</div>
                                  <Badge variant="outline" className="rounded-full text-[11px] uppercase">
                                    {step.type}
                                  </Badge>
                                </div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {step.url || step.selector || step.waitForText || step.screenshotName || step.text || step.key || t('browser.noExtraData')}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {replayResult && replayResult.workflowId === selectedWorkflow.id && (
                          <div className="mt-5 rounded-[22px] border border-border/60 bg-muted/20 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold">{t('browser.lastReplay')}</div>
                              <Badge className={cn(
                                'rounded-full',
                                replayResult.status === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white',
                              )}>
                                {replayResult.status}
                              </Badge>
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                              <div>{t('browser.finalUrl')}: {replayResult.finalUrl || t('browser.unavailable')}</div>
                              <div>{t('browser.downloads')}: {replayResult.downloadedFiles.length}</div>
                              <div>{t('browser.screenshots')}: {replayResult.screenshots.length}</div>
                              <div>{t('browser.started')}: {formatTimestamp(replayResult.startedAt, t('browser.justNow'))}</div>
                              {replayResult.error && (
                                <div className="text-rose-600">{t('browser.error')}: {replayResult.error}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="downloads" className="min-h-0">
                <ScrollArea className="h-full">
                  <div className="space-y-4 p-4">
                    <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{t('browser.recentDownloads')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t('browser.recentDownloadsDesc')}
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-full">{downloads.length}</Badge>
                      </div>

                      <div className="mt-4 space-y-3">
                        {downloads.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                            {t('browser.noDownloads')}
                          </div>
                        )}

                        {downloads.map((download) => (
                          <div key={download.id} className="rounded-2xl border border-border/60 bg-background px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{download.fileName}</div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">{download.path}</div>
                                <div className="mt-2 text-xs text-muted-foreground">
                                  {download.totalBytes ? `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}` : download.state}
                                </div>
                              </div>
                              <Badge variant="outline" className="rounded-full text-[11px] uppercase">
                                {download.state}
                              </Badge>
                            </div>
                            {download.done && (
                              <div className="mt-3 flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => void handleOpenDownload(download)}>
                                  <Download className="size-4" />
                                  {t('browser.open')}
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    {completedDownloads.length > 0 && replayResult && (
                      <section className="rounded-[22px] border border-border/60 bg-background/80 p-4">
                        <div className="text-sm font-semibold">{t('browser.replayOutput')}</div>
                        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                          <div>{t('browser.downloadsExported')}: {replayResult.downloadedFiles.length}</div>
                          <div>{t('browser.screenshotsExported')}: {replayResult.screenshots.length}</div>
                          <div>{t('browser.extractedDataKeys')}: {Object.keys(replayResult.extractedData).length}</div>
                        </div>
                      </section>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>

      <div className="border-t border-border/60 bg-background/90 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="outline" className="rounded-full">
            {tabs.length} {tabs.length === 1 ? t('browser.tab') : t('browser.tabs')}
          </Badge>
          <Badge variant="outline" className="rounded-full">
            {contextEvents.length} {contextEvents.length === 1 ? t('browser.capturedEvent') : t('browser.capturedEvents')}
          </Badge>
          <Badge variant="outline" className="rounded-full">
            {workflows.length} {workflows.length === 1 ? t('browser.workflow') : t('browser.workflowsPlural')}
          </Badge>
          {activeTab?.url && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 hover:bg-accent"
              onClick={() => void window.electronAPI?.shell?.openExternal(activeTab.url)}
            >
              <ExternalLink className="size-3.5" />
              {t('browser.openCurrentPageExternally')}
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 hover:bg-accent"
            onClick={() => openPromptInChat(t('browser.helpPlanDebug'))}
          >
            <History className="size-3.5" />
            {t('browser.askChatAboutTask')}
          </button>
        </div>
      </div>
    </div>
  );
}
