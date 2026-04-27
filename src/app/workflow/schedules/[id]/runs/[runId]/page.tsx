'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RunOutputRenderer } from '@/components/workflow/RunOutputRenderer';
import { OutputFilesSection } from '@/components/workflow/OutputFilesSection';
import { WorkflowDslGraph, type WorkflowDslStepOverlay } from '@/components/workflow/WorkflowDslGraph';
import { WorkflowStepDetailPanel } from '@/components/workflow/WorkflowStepDetailPanel';
import { RunDetailHeader } from '@/components/workflow/RunDetailHeader';
import { RunningStepsLivePanel } from '@/components/workflow/RunningStepsLivePanel';
import type { WorkflowDSLV3 } from '@/lib/workflow/types-v3';
import type { StepTraceEvent } from '@/lib/workflow/step-trace-stream';

function normalizeRunDsl(raw: unknown): WorkflowDSLV3 | null {
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as { version?: string }).version === 'v3' &&
    Array.isArray((raw as { nodes?: unknown }).nodes) &&
    Array.isArray((raw as { edges?: unknown }).edges)
  ) {
    return raw as WorkflowDSLV3;
  }
  return null;
}

interface RunRecord {
  id: string;
  scheduleId: string;
  sessionId: string | null;
  status: 'running' | 'success' | 'error' | 'cancelled';
  error: string;
  startedAt: string;
  completedAt: string | null;
}

interface DbMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface OutputFile {
  name: string;
  stepId: string;
  agentName: string;
  content: string;
  sizeBytes: number;
  filePath: string;
  mimeType?: string;
  createdAt?: string;
}

interface RunDetailResponse {
  run?: RunRecord;
  messages?: DbMessage[];
  outputFiles?: OutputFile[];
  workflowDsl?: unknown;
  workflowDslSource?: 'snapshot' | 'live' | 'none';
  stepOverlays?: Record<string, WorkflowDslStepOverlay>;
  presetNames?: Record<string, string>;
  stepInputSnapshots?: Record<string, unknown>;
  stepLiveTraces?: Record<string, StepTraceEvent[]>;
  error?: string;
}

function extractParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return typeof val === 'string' ? val : '';
}

async function fetchRunDetail(scheduleId: string, runId: string): Promise<RunDetailResponse> {
  const primaryUrl = `/api/workflow/schedules/${encodeURIComponent(scheduleId)}/runs/${encodeURIComponent(runId)}`;
  const fallbackUrl = `/api/workflow/schedule-runs/${encodeURIComponent(runId)}?scheduleId=${encodeURIComponent(scheduleId)}`;

  const primaryRes = await fetch(primaryUrl, { cache: 'no-store' });
  if (primaryRes.ok) {
    return await primaryRes.json() as RunDetailResponse;
  }

  if (primaryRes.status === 404) {
    const fallbackRes = await fetch(fallbackUrl, { cache: 'no-store' });
    if (fallbackRes.ok) {
      return await fallbackRes.json() as RunDetailResponse;
    }

    const fallbackBody = await fallbackRes.json().catch(() => ({})) as RunDetailResponse;
    throw new Error(fallbackBody.error || `请求失败 (${fallbackRes.status})`);
  }

  const primaryBody = await primaryRes.json().catch(() => ({})) as RunDetailResponse;
  throw new Error(primaryBody.error || `请求失败 (${primaryRes.status})`);
}

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scheduleId = extractParam(params.id);
  const runId = extractParam(params.runId);

  const [run, setRun] = useState<RunRecord | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [workflowDsl, setWorkflowDsl] = useState<WorkflowDSLV3 | null>(null);
  const [workflowDslSource, setWorkflowDslSource] = useState<'snapshot' | 'live' | 'none'>('none');
  const [stepOverlays, setStepOverlays] = useState<Record<string, WorkflowDslStepOverlay>>({});
  const [presetNames, setPresetNames] = useState<Record<string, string>>({});
  const [stepInputSnapshots, setStepInputSnapshots] = useState<Record<string, unknown>>({});
  const [stepLiveTraces, setStepLiveTraces] = useState<Record<string, StepTraceEvent[]>>({});
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!runId || !scheduleId) {
      setError(`参数缺失: scheduleId=${scheduleId}, runId=${runId}`);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchRunDetail(scheduleId, runId);
      if (data.run) setRun(data.run);
      if (data.messages) setMessages(data.messages);
      if (data.outputFiles) setOutputFiles(data.outputFiles);
      if (data.workflowDsl !== undefined) setWorkflowDsl(normalizeRunDsl(data.workflowDsl));
      if (data.workflowDslSource) setWorkflowDslSource(data.workflowDslSource);
      if (data.stepOverlays) setStepOverlays(data.stepOverlays);
      if (data.presetNames) setPresetNames(data.presetNames);
      if (data.stepInputSnapshots) setStepInputSnapshots(data.stepInputSnapshots);
      if (data.stepLiveTraces) setStepLiveTraces(data.stepLiveTraces);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally { setLoading(false); }
  }, [scheduleId, runId]);

  useEffect(() => { void load(); }, [load]);

  const isRunning = run?.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    pollRef.current = setInterval(() => { void load(); }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isRunning, load]);

  const handleCancel = useCallback(async () => {
    if (!scheduleId || !runId || cancelling) return;
    setCancelling(true);
    setError('');
    try {
      const res = await fetch(`/api/workflow/schedules/${encodeURIComponent(scheduleId)}/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '用户从执行记录页停止任务' }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || '停止执行失败');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '停止执行失败');
    } finally {
      setCancelling(false);
    }
  }, [cancelling, load, runId, scheduleId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />)}
      </div>
    );
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 text-center text-muted-foreground space-y-2">
        <p>执行记录不存在</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button variant="outline" className="mt-4" onClick={() => router.push(`/workflow/schedules/${scheduleId}`)}>
          返回定时任务
        </Button>
      </div>
    );
  }

  const assistantCount = messages.filter(m => m.role === 'assistant').length;
  const hasOutputFiles = outputFiles.length > 0;
  const hasWorkflow = Boolean(workflowDsl && workflowDsl.nodes.length > 0);
  const defaultTab = run.status === 'error'
    ? 'process'
    : hasWorkflow
      ? 'workflow'
      : hasOutputFiles
        ? 'results'
        : 'process';

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={() => router.push('/workflow/schedules')} className="hover:text-foreground transition-colors">
          定时任务
        </button>
        <span>/</span>
        <button onClick={() => router.push(`/workflow/schedules/${scheduleId}`)} className="hover:text-foreground transition-colors">
          任务详情
        </button>
        <span>/</span>
        <span className="text-foreground">执行记录</span>
      </div>

      <RunDetailHeader
        run={run}
        onRefresh={() => void load()}
        onCancel={isRunning ? () => void handleCancel() : undefined}
        cancelling={cancelling}
      />

      {/* Tabs: workflow / results / execution process */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="workflow" disabled={!hasWorkflow}>
            工作流结构
            {hasWorkflow && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
                {workflowDsl?.nodes.length ?? 0}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="results" disabled={!hasOutputFiles}>
            结果文件
            {hasOutputFiles && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
                {outputFiles.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="process">
            执行过程
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
              {assistantCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflow">
          {hasWorkflow && workflowDsl ? (
            <div className="space-y-3">
              {workflowDslSource === 'live' && (
                <div className="text-[11px] px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
                  注意：此执行记录未保存配置快照，下方展示的是工作流的当前定义，与实际执行时可能不同。
                </div>
              )}
              <WorkflowDslGraph
                dsl={workflowDsl}
                presetNames={presetNames}
                stepOverlays={stepOverlays}
                selectedStepId={selectedStepId}
                onStepClick={(stepId) => setSelectedStepId(prev => prev === stepId ? null : stepId)}
              />
              {selectedStepId && (() => {
                const selectedNode = workflowDsl.nodes.find(n => n.id === selectedStepId);
                if (!selectedNode) return null;
                return (
                  <WorkflowStepDetailPanel
                    node={selectedNode}
                    presetNames={presetNames}
                    overlay={stepOverlays[selectedStepId]}
                    outputFiles={outputFiles}
                    inputSnapshot={stepInputSnapshots[selectedStepId]}
                    liveTrace={stepLiveTraces[selectedStepId]}
                    onClose={() => setSelectedStepId(null)}
                  />
                );
              })()}
              {!selectedStepId && (
                <div className="text-center py-3 text-[11px] text-muted-foreground">
                  点击任一节点查看该步骤的配置与执行详情
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50">
              无可用工作流配置
            </div>
          )}
        </TabsContent>

        <TabsContent value="results">
          {hasOutputFiles ? (
            <OutputFilesSection files={outputFiles} />
          ) : (
            <div className="text-center py-16 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50">
              暂无结果文件
            </div>
          )}
        </TabsContent>

        <TabsContent value="process">
          {isRunning && (
            <RunningStepsLivePanel
              stepLiveTraces={stepLiveTraces}
              stepOverlays={stepOverlays}
              workflowDsl={workflowDsl}
            />
          )}
          <RunOutputRenderer messages={messages} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
