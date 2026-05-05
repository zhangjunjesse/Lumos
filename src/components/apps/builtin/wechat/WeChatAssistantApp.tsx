'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { AutomationTab } from './AutomationTab';
import { ContentInsightsTab } from './ContentInsightsTab';
import { OverviewTab } from './OverviewTab';
import { PortraitTab } from './PortraitTab';
import { SetupBanner, SetupSection } from './SetupSection';
import { WeChatHero } from './WeChatHero';
import {
  readableAnalysisError,
  type AgentMessage,
  type Analysis,
  type AppTab,
  type BuiltinTask,
  type WeChatAssistantStatus,
} from './wechat-types';

const INITIAL_AGENT: AgentMessage[] = [
  {
    role: 'assistant',
    content:
      '我是微信助手。可以告诉我什么时候发总结、要不要提取待办，或让我立刻刷新一次分析。',
  },
];

export function WeChatAssistantApp(): React.ReactElement {
  const [tab, setTab] = React.useState<AppTab>('overview');
  const [status, setStatus] = React.useState<WeChatAssistantStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [tasks, setTasks] = React.useState<BuiltinTask[]>([]);
  const [taskBusyId, setTaskBusyId] = React.useState<string | null>(null);
  const [agentInput, setAgentInput] = React.useState('');
  const [agentBusy, setAgentBusy] = React.useState(false);
  const [agentMessages, setAgentMessages] = React.useState<AgentMessage[]>(INITIAL_AGENT);
  const [setupExpanded, setSetupExpanded] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/apps/builtin/wechat/status', { cache: 'no-store' });
      const json = (await res.json()) as WeChatAssistantStatus & { error?: string };
      if (!res.ok) throw new Error(json.error ?? '状态加载失败');
      setStatus(json);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : '状态加载失败');
    }
  }, []);

  const loadTasks = React.useCallback(async () => {
    const res = await fetch('/api/apps/builtin/wechat/tasks', { cache: 'no-store' });
    const json = (await res.json()) as { tasks?: BuiltinTask[] };
    setTasks(json.tasks ?? []);
  }, []);

  const refreshAnalysis = React.useCallback(async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch('/api/apps/builtin/wechat/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMessages: 50000 }),
      });
      const json = (await res.json()) as { analysis?: Analysis; error?: string; message?: string };
      if (!res.ok || !json.analysis) {
        throw new Error(readableAnalysisError(json.error, json.message));
      }
      setAnalysis(json.analysis);
      await loadTasks();
      await loadStatus();
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setAnalysisLoading(false);
    }
  }, [loadStatus, loadTasks]);

  React.useEffect(() => {
    void loadStatus();
    void loadTasks();
  }, [loadStatus, loadTasks]);

  React.useEffect(() => {
    if (status?.export.ready && !analysis && !analysisLoading && !analysisError) {
      void refreshAnalysis();
    }
  }, [analysis, analysisError, analysisLoading, refreshAnalysis, status?.export.ready]);

  const updateTask = React.useCallback(
    async (task: BuiltinTask, patch: Partial<Pick<BuiltinTask, 'enabled' | 'schedule'>>) => {
      setTaskBusyId(task.id);
      try {
        const res = await fetch('/api/apps/builtin/wechat/tasks', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: task.id, ...patch }),
        });
        const json = (await res.json()) as { tasks?: BuiltinTask[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? '保存失败');
        setTasks(json.tasks ?? []);
      } finally {
        setTaskBusyId(null);
      }
    },
    [],
  );

  const sendAgentMessage = React.useCallback(async () => {
    const message = agentInput.trim();
    if (!message || agentBusy) return;
    setAgentInput('');
    setAgentMessages((items) => [...items, { role: 'user', content: message }]);
    setAgentBusy(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const json = (await res.json()) as {
        reply?: string;
        tasks?: BuiltinTask[];
        actions?: Array<{ type: string; label: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? '助手暂时不可用');
      if (json.tasks) setTasks(json.tasks);
      setAgentMessages((items) => [...items, { role: 'assistant', content: json.reply ?? '已处理。' }]);
      if (json.actions?.some((action) => action.type === 'refresh_analysis')) {
        setTab('overview');
        void refreshAnalysis();
      }
    } catch (err) {
      setAgentMessages((items) => [
        ...items,
        { role: 'assistant', content: err instanceof Error ? err.message : '助手暂时不可用' },
      ]);
    } finally {
      setAgentBusy(false);
    }
  }, [agentBusy, agentInput, refreshAnalysis]);

  const ready = !!status?.export.ready;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <WeChatHero
        status={status}
        analysis={analysis}
        loading={analysisLoading}
        onRefresh={refreshAnalysis}
      />
      <SetupBanner
        status={status}
        onRefresh={loadStatus}
        onOpenDetails={() => setSetupExpanded((v) => !v)}
        expanded={setupExpanded}
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as AppTab)} className="min-h-0 flex-1">
        <div className="overflow-x-auto border-b px-8">
          <TabsList className="h-auto min-w-max gap-7 bg-transparent p-0">
            <TabPill value="overview" label="概览" />
            <TabPill value="portrait" label="画像" />
            <TabPill value="content" label="洞察" />
            <TabPill value="automation" label="自动化" />
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-8">
          {statusError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle />
              <AlertDescription>{statusError}</AlertDescription>
            </Alert>
          ) : null}

          {(setupExpanded || !ready) ? (
            <div className="mb-4">
              <SetupSection
                status={status}
                onStatusRefresh={loadStatus}
                defaultExpanded={setupExpanded || !ready}
              />
            </div>
          ) : null}

          <TabsContent value="overview" className="m-0">
            <OverviewTab
              ready={ready}
              analysis={analysis}
              loading={analysisLoading}
              error={analysisError}
              onRefresh={refreshAnalysis}
            />
          </TabsContent>

          <TabsContent value="portrait" className="m-0">
            <PortraitTab
              ready={ready}
              portrait={analysis?.portrait ?? null}
              loading={analysisLoading}
              error={analysisError}
              onRefresh={refreshAnalysis}
              onSetup={() => setSetupExpanded(true)}
            />
          </TabsContent>

          <TabsContent value="content" className="m-0">
            <ContentInsightsTab
              ready={ready}
              analysis={analysis}
              loading={analysisLoading}
              error={analysisError}
              onRefresh={refreshAnalysis}
            />
          </TabsContent>

          <TabsContent value="automation" className="m-0">
            <AutomationTab
              tasks={tasks}
              busyId={taskBusyId}
              analysisLoading={analysisLoading}
              agent={{ messages: agentMessages, input: agentInput, busy: agentBusy }}
              onUpdate={updateTask}
              onAgentInput={setAgentInput}
              onAgentSend={sendAgentMessage}
              onRunSummary={() => {
                setTab('overview');
                void refreshAnalysis();
              }}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function TabPill({ value, label }: { value: string; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="relative h-auto shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {label}
    </TabsTrigger>
  );
}
