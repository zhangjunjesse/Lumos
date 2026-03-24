'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type WorkflowTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type WorkflowTaskStrategy = 'simple' | 'workflow';
type WorkflowAgentRoleId = 'scheduling' | 'worker' | 'researcher' | 'coder' | 'integration';

interface WorkflowTaskListItem {
  id: string;
  summary: string;
  status: WorkflowTaskStatus;
  progress?: number;
  estimatedDuration?: number;
  strategy?: WorkflowTaskStrategy;
  createdAt: string;
}

interface WorkflowPlannerDiagnostics {
  llmAttempted?: boolean;
  llmAttempts?: number;
  llmErrors?: string[];
  llmTimeoutMs?: number;
  llmSkippedReason?: string;
  fallbackUsed?: 'heuristic-preview';
  fallbackReason?: string;
}

interface WorkflowPlannerInfo {
  source?: 'heuristic' | 'llm';
  reason?: string;
  analysis?: {
    complexity?: 'simple' | 'moderate' | 'complex';
    needsBrowser?: boolean;
    needsNotification?: boolean;
    needsMultipleSteps?: boolean;
    needsParallel?: boolean;
    detectedUrl?: string;
    detectedUrls?: string[];
  };
  model?: string;
  diagnostics?: WorkflowPlannerDiagnostics;
}

interface WorkflowSchedulingValidation {
  valid?: boolean;
  errors?: string[];
}

interface WorkflowSchedulingManifest {
  workflowName?: string;
  workflowVersion?: string;
  stepIds?: string[];
  stepTypes?: string[];
  artifactKind?: string;
  dslVersion?: string;
  exportedSymbol?: string;
}

interface WorkflowStepPlan {
  id: string;
  type: 'agent' | 'browser' | 'notification' | 'capability';
  dependsOn?: string[];
  input?: Record<string, unknown>;
}

interface WorkflowTaskStepResult {
  success?: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface WorkflowTaskResult {
  mode?: 'simple';
  workflowId?: string;
  durationMs?: number;
  outputs?: Record<string, WorkflowTaskStepResult | null>;
}

interface WorkflowTaskDetail extends WorkflowTaskListItem {
  requirements?: string[];
  startedAt?: string;
  completedAt?: string;
  errors?: Array<{
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  }>;
  result?: WorkflowTaskResult;
  metadata?: {
    cancelReason?: string;
    scheduling?: {
      accepted?: boolean;
      strategy?: WorkflowTaskStrategy;
      message?: string;
      generator?: string;
      estimatedDurationSeconds?: number;
      planner?: WorkflowPlannerInfo;
      fallback?: {
        source?: string;
        reason?: string;
        errors?: string[];
        simpleExecutionId?: string;
      };
      validation?: WorkflowSchedulingValidation;
      workflowManifest?: WorkflowSchedulingManifest;
      workflowDsl?: {
        steps?: WorkflowStepPlan[];
      };
    };
    workflow?: {
      workflowId?: string;
      simpleExecutionId?: string;
      status?: string;
      progress?: number;
      currentStep?: string;
      completedSteps?: string[];
      runningSteps?: string[];
      skippedSteps?: string[];
      currentAgentRole?: string;
      workflowName?: string;
      workflowVersion?: string;
      stepIds?: string[];
      startedAt?: string;
      completedAt?: string;
      updatedAt?: string;
      error?: {
        code?: string;
        message?: string;
        stepName?: string;
        details?: Record<string, unknown>;
      };
      cancelReason?: string;
    };
  };
}

interface WorkflowAgentRoleProfile {
  role: WorkflowAgentRoleId;
  title: string;
  shortLabel: string;
  scope: 'planning' | 'execution';
  description: string;
  roleName: string;
  agentType: string;
  systemPrompt: string;
  hasOverrides: boolean;
  tools: string[];
  notes?: string[];
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  plannerTimeoutMs?: number;
  plannerMaxRetries?: number;
}

type WorkflowStepVisualState = 'done' | 'running' | 'pending' | 'failed' | 'skipped';

interface WorkflowGraphNodeLayout {
  step: WorkflowStepPlan;
  x: number;
  y: number;
}

const QUICK_RECIPES = [
  {
    label: '单步代理',
    summary: '输出一句简短摘要',
    requirements: ['一句话即可'],
    relevantMessages: [],
  },
  {
    label: '浏览器流程',
    summary: '打开 https://example.com 并截图，然后通知我',
    requirements: ['打开页面', '截图', '通知结果'],
    relevantMessages: ['这是一个用于验证浏览器步骤编排的工作流任务。'],
  },
  {
    label: '并行浏览器',
    summary: '同时打开 https://example.com 和 https://openai.com 并分别截图，然后通知我',
    requirements: ['同时打开两个页面', '分别截图', '通知结果'],
    relevantMessages: ['这是一个用于验证并行调度与稳定 stepId 映射的工作流任务。'],
  },
  {
    label: '复杂并行浏览器',
    summary: '同时打开 https://example.com、https://example.org 和 https://example.net，分别截图后再通知我',
    requirements: ['同时打开三个页面', '分别截图', '保持每个步骤与输出稳定对应', '最后统一通知结果'],
    relevantMessages: ['这是一个用于验证复杂并行工作流视图、分支依赖和最终汇聚通知的验收任务。'],
  },
  {
    label: '混合复杂工作流',
    summary: '先整理比较维度，然后同时打开 https://example.com、https://example.org 和 https://example.net，分别截图，最后汇总结论并通知我',
    requirements: ['先整理比较维度', '同时打开三个页面', '分别截图', '最后汇总结论并通知结果'],
    relevantMessages: ['这是一个用于验证前置分析、并行浏览器分支、汇总代理和最终通知的正式验收任务。'],
  },
] as const;

function getStatusClassName(status: WorkflowTaskStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
    case 'running':
      return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    case 'failed':
      return 'bg-red-500/10 text-red-700 border-red-500/20';
    case 'cancelled':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    default:
      return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
  }
}

function getStrategyClassName(strategy?: WorkflowTaskStrategy): string {
  if (strategy === 'workflow') return 'bg-violet-500/10 text-violet-700 border-violet-500/20';
  if (strategy === 'simple') return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
  return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
}

function getPlannerSourceLabel(source?: 'heuristic' | 'llm'): string {
  if (source === 'llm') return '模型分析';
  if (source === 'heuristic') return '规则预判';
  return '未提供';
}

function getStrategyLabel(strategy?: WorkflowTaskStrategy): string {
  if (strategy === 'workflow') return '工作流编排';
  if (strategy === 'simple') return '简单执行';
  return '等待规划';
}

function getYesNoLabel(value?: boolean): string {
  return value ? '是' : '否';
}

function getPlannerGeneratorLabel(value?: string): string {
  if (value === 'llm-planner') return '模型规划器';
  if (value === 'heuristic-planner') return '规则规划器';
  return value || '未提供';
}

function getStepTypeLabel(type: WorkflowStepPlan['type']): string {
  switch (type) {
    case 'agent':
      return '代理步骤';
    case 'browser':
      return '浏览器步骤';
    case 'notification':
      return '通知步骤';
    case 'capability':
      return '能力步骤';
    default:
      return type;
  }
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '未提供';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return remainSeconds > 0 ? `${minutes} 分 ${remainSeconds} 秒` : `${minutes} 分钟`;
}

function isWorkflowAgentRoleId(value: string): value is WorkflowAgentRoleId {
  return (
    value === 'scheduling'
    || value === 'worker'
    || value === 'researcher'
    || value === 'coder'
    || value === 'integration'
  );
}

function getAgentRoleId(step: WorkflowStepPlan): WorkflowAgentRoleId | null {
  if (step.type !== 'agent') {
    return null;
  }

  const rawRole = step.input?.role;
  if (typeof rawRole !== 'string') {
    return 'worker';
  }

  const normalizedRole = rawRole.trim().toLowerCase();
  if (
    normalizedRole === 'worker'
    || normalizedRole === 'researcher'
    || normalizedRole === 'coder'
    || normalizedRole === 'integration'
  ) {
    return normalizedRole;
  }

  return 'worker';
}

function getStepVisualState(
  stepId: string,
  detail: WorkflowTaskDetail | null,
): WorkflowStepVisualState {
  const snapshot = detail?.result?.outputs?.[stepId];
  if (snapshot?.success === false) {
    return 'failed';
  }

  const currentStep = detail?.metadata?.workflow?.currentStep;
  const completedSteps = detail?.metadata?.workflow?.completedSteps || [];
  const skippedSteps = detail?.metadata?.workflow?.skippedSteps || [];

  if (completedSteps.includes(stepId)) {
    return 'done';
  }
  if (skippedSteps.includes(stepId)) {
    return 'skipped';
  }
  if (currentStep === stepId) {
    if (detail?.status === 'failed') {
      return 'failed';
    }
    return 'running';
  }

  if (snapshot?.success) {
    return 'done';
  }

  return 'pending';
}

function getStepVisualLabel(state: WorkflowStepVisualState): string {
  switch (state) {
    case 'done':
      return '已完成';
    case 'running':
      return '执行中';
    case 'skipped':
      return '已跳过';
    case 'failed':
      return '失败';
    case 'pending':
    default:
      return '待执行';
  }
}

function getStepVisualClassName(state: WorkflowStepVisualState): string {
  switch (state) {
    case 'done':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    case 'running':
      return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
    case 'skipped':
      return 'bg-slate-500/10 text-slate-600 border-slate-400/20';
    case 'failed':
      return 'bg-red-500/10 text-red-700 border-red-500/20';
    case 'pending':
    default:
      return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
  }
}

function getStepTypeClassName(type: WorkflowStepPlan['type']): string {
  switch (type) {
    case 'agent':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    case 'browser':
      return 'bg-sky-500/10 text-sky-700 border-sky-500/20';
    case 'notification':
      return 'bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/20';
    case 'capability':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    default:
      return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
  }
}

function buildExecutionLayers(steps: WorkflowStepPlan[]): WorkflowStepPlan[][] {
  const stepMap = new Map<string, WorkflowStepPlan>();
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const order = new Map<string, number>();

  steps.forEach((step, index) => {
    stepMap.set(step.id, step);
    indegree.set(step.id, step.dependsOn?.length ?? 0);
    order.set(step.id, index);
  });

  steps.forEach((step) => {
    for (const dependency of step.dependsOn ?? []) {
      if (!stepMap.has(dependency)) {
        continue;
      }
      const current = dependents.get(dependency) ?? [];
      current.push(step.id);
      dependents.set(dependency, current);
    }
  });

  const layers: WorkflowStepPlan[][] = [];
  const remaining = new Set(steps.map((step) => step.id));

  while (remaining.size > 0) {
    const nextLayerIds = Array.from(remaining)
      .filter((stepId) => (indegree.get(stepId) ?? 0) === 0)
      .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));

    if (nextLayerIds.length === 0) {
      return [steps];
    }

    layers.push(nextLayerIds.map((stepId) => stepMap.get(stepId)!));

    for (const stepId of nextLayerIds) {
      remaining.delete(stepId);
      for (const dependentId of dependents.get(stepId) ?? []) {
        indegree.set(dependentId, (indegree.get(dependentId) ?? 0) - 1);
      }
    }
  }

  return layers;
}

function formatDateTime(value?: string): string {
  if (!value) return '未提供';
  return new Date(value).toLocaleString();
}

function createSimpleExecutionStep(): WorkflowStepPlan {
  return {
    id: 'main',
    type: 'agent',
    input: {
      role: 'worker',
    },
  };
}

function stringifyOutputValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractPreferredOutputText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['summary', 'message', 'result', 'content', 'text']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return stringifyOutputValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateText(value: string, maxLength: number = 220): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isImageFilePath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(value);
}

function buildRawFileUrl(filePath: string): string {
  return `/api/files/raw?path=${encodeURIComponent(filePath)}`;
}

function formatRuntimeValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => formatRuntimeValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    return items.length > 0 ? items.join('、') : null;
  }
  return null;
}

function getNotificationDeliveryLabel(value: unknown): string | null {
  switch (value) {
    case 'session-message':
      return '当前会话';
    case 'feishu':
      return '飞书';
    case 'console':
      return '控制台';
    default:
      return formatRuntimeValue(value);
  }
}

function getExecutionModeLabel(value: unknown): string | null {
  switch (value) {
    case 'browser-bridge':
      return '浏览器桥接';
    case 'published-capability':
      return '已发布能力';
    case 'synthetic':
      return '模拟执行';
    case 'claude':
      return 'Claude 真实执行';
    case 'auto':
      return '自动模式';
    default:
      return formatRuntimeValue(value);
  }
}

function buildStepRuntimeNotes(snapshot: WorkflowTaskStepResult | null | undefined): string[] {
  if (!snapshot) {
    return [];
  }

  const notes: string[] = [];
  const output = isRecord(snapshot.output) ? snapshot.output : null;
  const metadata = isRecord(snapshot.metadata) ? snapshot.metadata : null;
  const memoryRefs = isRecord(metadata?.memoryRefs) ? metadata.memoryRefs : null;
  const workspace = isRecord(metadata?.workspace) ? metadata.workspace : null;
  const metrics = output && isRecord(output.metrics) ? output.metrics : null;

  const executionMode = getExecutionModeLabel(metadata?.executionMode);
  if (executionMode) {
    notes.push(`执行方式：${executionMode}`);
  }

  const requestedModel = formatRuntimeValue(metadata?.requestedModel);
  if (requestedModel) {
    notes.push(`请求模型：${requestedModel}`);
  }

  const bridgeSource = formatRuntimeValue(metadata?.bridgeSource);
  if (bridgeSource) {
    notes.push(`浏览器来源：${bridgeSource}`);
  }

  const deliveryMode = getNotificationDeliveryLabel(metadata?.deliveryMode);
  if (deliveryMode) {
    notes.push(`通知发送到：${deliveryMode}`);
  }

  const allowedTools = formatRuntimeValue(metadata?.allowedTools);
  if (allowedTools) {
    notes.push(`允许工具：${allowedTools}`);
  }

  const capabilityId = formatRuntimeValue(metadata?.capabilityId);
  if (capabilityId) {
    notes.push(`能力 ID：${capabilityId}`);
  }

  const ignoredToolRequests = formatRuntimeValue(metadata?.ignoredToolRequests);
  if (ignoredToolRequests) {
    notes.push(`忽略的工具请求：${ignoredToolRequests}`);
  }

  const sessionId = formatRuntimeValue(metadata?.sessionId);
  if (sessionId) {
    notes.push(`代理会话：${sessionId}`);
  }

  const runId = formatRuntimeValue(metadata?.runId);
  if (runId) {
    notes.push(`运行批次：${runId}`);
  }

  const stageId = formatRuntimeValue(metadata?.stageId);
  if (stageId) {
    notes.push(`执行步骤槽位：${stageId}`);
  }

  const concurrencyLimit = formatRuntimeValue(metadata?.concurrencyLimit);
  if (concurrencyLimit) {
    notes.push(`实际并发上限：${concurrencyLimit}`);
  }

  const memoryPolicy = formatRuntimeValue(metadata?.memoryPolicy);
  if (memoryPolicy) {
    notes.push(`实际记忆策略：${memoryPolicy}`);
  }

  const capabilityTags = formatRuntimeValue(metadata?.capabilityTags);
  if (capabilityTags) {
    notes.push(`能力标签：${capabilityTags}`);
  }

  const taskMemoryId = formatRuntimeValue(memoryRefs?.taskMemoryId);
  if (taskMemoryId) {
    notes.push(`任务记忆槽：${taskMemoryId}`);
  }

  const plannerMemoryId = formatRuntimeValue(memoryRefs?.plannerMemoryId);
  if (plannerMemoryId) {
    notes.push(`规划记忆槽：${plannerMemoryId}`);
  }

  const agentMemoryId = formatRuntimeValue(memoryRefs?.agentMemoryId);
  if (agentMemoryId) {
    notes.push(`代理记忆槽：${agentMemoryId}`);
  }

  const sessionWorkspace = formatRuntimeValue(workspace?.sessionWorkspace);
  if (sessionWorkspace) {
    notes.push(`会话工作目录：${sessionWorkspace}`);
  }

  const runWorkspace = formatRuntimeValue(workspace?.runWorkspace);
  if (runWorkspace) {
    notes.push(`运行隔离目录：${runWorkspace}`);
  }

  const stageWorkspace = formatRuntimeValue(workspace?.stageWorkspace);
  if (stageWorkspace) {
    notes.push(`隔离工作目录：${stageWorkspace}`);
  }

  const sharedReadDir = formatRuntimeValue(workspace?.sharedReadDir);
  if (sharedReadDir) {
    notes.push(`共享只读目录：${sharedReadDir}`);
  }

  const artifactOutputDir = formatRuntimeValue(workspace?.artifactOutputDir);
  if (artifactOutputDir) {
    notes.push(`输出目录：${artifactOutputDir}`);
  }

  const targetUrl = formatRuntimeValue(output?.url);
  if (targetUrl) {
    notes.push(`目标页面：${targetUrl}`);
  }

  const screenshotPath = formatRuntimeValue(output?.screenshotPath);
  if (screenshotPath) {
    notes.push(`输出文件：${screenshotPath}`);
  }

  const channel = formatRuntimeValue(output?.channel);
  if (channel) {
    notes.push(`通知渠道：${channel}`);
  }

  const detailArtifactPath = formatRuntimeValue(output?.detailArtifactPath);
  if (detailArtifactPath) {
    notes.push(`详细结果文件：${detailArtifactPath}`);
  }

  const durationMs = formatRuntimeValue(metrics?.durationMs);
  if (durationMs) {
    notes.push(`执行耗时：${durationMs} ms`);
  }

  const apiCalls = formatRuntimeValue(metrics?.apiCalls);
  if (apiCalls) {
    notes.push(`模型调用次数：${apiCalls}`);
  }

  const tokensUsed = formatRuntimeValue(metrics?.tokensUsed);
  if (tokensUsed) {
    notes.push(`Token 使用量：${tokensUsed}`);
  }

  return notes;
}

function getStepActorLabel(
  step: WorkflowStepPlan,
  workflowRoles: WorkflowAgentRoleProfile[],
): string {
  const roleId = getAgentRoleId(step);
  const roleProfile = roleId
    ? workflowRoles.find((role) => role.role === roleId)
    : null;

  if (roleProfile) {
    return roleProfile.shortLabel;
  }

  if (step.type === 'browser') {
    return '系统浏览器';
  }

  if (step.type === 'notification') {
    return '系统通知';
  }

  if (step.type === 'capability') {
    return '系统能力';
  }

  return '系统执行';
}

function getRoleBoundaryNote(role: WorkflowAgentRoleProfile): string | null {
  const note = role.notes?.find((item) => typeof item === 'string' && item.trim().length > 0);
  return note?.trim() || role.description || null;
}

function getTaskOutputEntries(
  detail: WorkflowTaskDetail | null,
  orderedStepIds: string[],
): Array<{
  stepId: string;
  success: boolean;
  text: string;
  error?: string;
}> {
  const outputs = detail?.result?.outputs;
  if (!outputs || typeof outputs !== 'object') {
    return [];
  }

  const unorderedStepIds = Object.keys(outputs).filter((stepId) => !orderedStepIds.includes(stepId));
  const stepIds = [...orderedStepIds, ...unorderedStepIds];

  return stepIds.flatMap((stepId) => {
    const snapshot = outputs[stepId];
    if (!snapshot) {
      return [];
    }

    const success = snapshot.success !== false;
    const text = extractPreferredOutputText(snapshot.output)
      || (snapshot.error ? snapshot.error.trim() : '')
      || '当前步骤没有可展示输出。';

    return [{
      stepId,
      success,
      text,
      ...(snapshot.error ? { error: snapshot.error } : {}),
    }];
  });
}

export function WorkflowCenterView() {
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<WorkflowTaskListItem[]>([]);
  const [selectedTask, setSelectedTask] = useState<WorkflowTaskDetail | null>(null);
  const [workflowRoles, setWorkflowRoles] = useState<WorkflowAgentRoleProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [taskSummaryInput, setTaskSummaryInput] = useState('输出一句简短摘要');
  const [requirementsInput, setRequirementsInput] = useState('一句话即可');
  const [relevantMessagesInput, setRelevantMessagesInput] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('workflow-center');
  const preferredTaskId = searchParams.get('taskId')?.trim() || searchParams.get('task')?.trim() || '';
  const sessionFilter = searchParams.get('sessionId')?.trim() || '';

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sessionFilter) {
        params.set('sessionId', sessionFilter);
      }
      const response = await fetch(`/api/task-management/tasks${params.toString() ? `?${params.toString()}` : ''}`);
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '加载任务列表失败');
    } finally {
      setLoading(false);
    }
  }, [sessionFilter]);

  const loadWorkflowRoles = useCallback(async () => {
    try {
      const response = await fetch('/api/workflow/agents', { cache: 'no-store' });
      const data = await response.json();
      setWorkflowRoles(Array.isArray(data.roles) ? data.roles : []);
    } catch {
      setWorkflowRoles([]);
    }
  }, []);

  const loadTaskDetail = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/task-management/tasks/${taskId}`);
      const data = await response.json();
      setSelectedTask(data.task || null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '加载任务详情失败');
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    void loadWorkflowRoles();
  }, [loadTasks, loadWorkflowRoles]);

  useEffect(() => {
    if (!sessionFilter) {
      return;
    }
    setSessionIdInput(sessionFilter);
  }, [sessionFilter]);

  useEffect(() => {
    if (!preferredTaskId || selectedTask?.id === preferredTaskId) {
      return;
    }
    void loadTaskDetail(preferredTaskId);
  }, [loadTaskDetail, preferredTaskId, selectedTask?.id]);

  useEffect(() => {
    if (!selectedTask?.id || ['completed', 'failed', 'cancelled'].includes(selectedTask.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTaskDetail(selectedTask.id);
      void loadTasks();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [loadTaskDetail, loadTasks, selectedTask?.id, selectedTask?.status]);

  const applyRecipe = (recipe: typeof QUICK_RECIPES[number]) => {
    setTaskSummaryInput(recipe.summary);
    setRequirementsInput(recipe.requirements.join('\n'));
    setRelevantMessagesInput(recipe.relevantMessages.join('\n'));
    setActionError(null);
    setActionMessage(`已套用：${recipe.label}`);
  };

  const createTask = async () => {
    const summary = taskSummaryInput.trim();
    const requirements = requirementsInput.split('\n').map((item) => item.trim()).filter(Boolean);
    const relevantMessages = relevantMessagesInput.split('\n').map((item) => item.trim()).filter(Boolean);
    const sessionId = sessionIdInput.trim() || `workflow-center-${Date.now()}`;

    if (!summary) {
      setActionError('请先填写任务摘要');
      return;
    }
    if (requirements.length === 0) {
      setActionError('请至少填写一条任务要求');
      return;
    }

    setCreating(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch('/api/task-management/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskSummary: summary,
          requirements,
          context: {
            sessionId,
            relevantMessages,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '创建工作流任务失败');
      }

      setSessionIdInput(typeof data.sessionId === 'string' && data.sessionId.trim() ? data.sessionId : sessionId);
      setActionMessage(`已创建任务：${data.taskId}`);
      await loadTasks();
      await loadTaskDetail(data.taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '创建工作流任务失败');
    } finally {
      setCreating(false);
    }
  };

  const cancelTask = async () => {
    if (!selectedTask?.id) {
      return;
    }

    setCancelling(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/task-management/${selectedTask.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'workflow-center-ui' }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '取消任务失败');
      }

      setActionMessage(data.message || '已发送取消请求');
      await loadTasks();
      await loadTaskDetail(selectedTask.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '取消任务失败');
    } finally {
      setCancelling(false);
    }
  };

  const taskStats = useMemo(() => {
    const active = tasks.filter((task) => task.status === 'pending' || task.status === 'running').length;
    const workflow = tasks.filter((task) => task.strategy === 'workflow').length;
    const simple = tasks.filter((task) => task.strategy === 'simple').length;
    return {
      total: tasks.length,
      active,
      workflow,
      simple,
    };
  }, [tasks]);

  const plannedSteps = useMemo(
    () => selectedTask?.metadata?.scheduling?.workflowDsl?.steps || [],
    [selectedTask?.metadata?.scheduling?.workflowDsl?.steps],
  );
  const schedulingInfo = selectedTask?.metadata?.scheduling;
  const plannerInfo = schedulingInfo?.planner;
  const plannerAnalysis = plannerInfo?.analysis;
  const plannerDiagnostics = plannerInfo?.diagnostics;
  const planningValidation = schedulingInfo?.validation;
  const workflowManifest = schedulingInfo?.workflowManifest;
  const effectiveStrategy = selectedTask?.metadata?.scheduling?.strategy || selectedTask?.strategy;
  const selectedSteps = useMemo(() => {
    if (!selectedTask) {
      return [];
    }

    if (effectiveStrategy === 'simple') {
      return [createSimpleExecutionStep()];
    }

    return plannedSteps;
  }, [effectiveStrategy, plannedSteps, selectedTask]);
  const outputEntries = useMemo(
    () => getTaskOutputEntries(selectedTask, selectedSteps.map((step) => step.id)),
    [selectedSteps, selectedTask],
  );
  const fallbackInfo = selectedTask?.metadata?.scheduling?.fallback;
  const workflowRuntime = selectedTask?.metadata?.workflow;
  const runtimeError = workflowRuntime?.error || selectedTask?.errors?.[0];
  const runningSteps = workflowRuntime?.runningSteps || [];
  const skippedSteps = workflowRuntime?.skippedSteps || [];
  const completedStepCount = workflowRuntime?.completedSteps?.length || 0;
  const totalStepCount = selectedSteps.length;
  const planningRoleProfile = useMemo(() => {
    if (!selectedTask?.metadata?.scheduling?.planner) {
      return null;
    }

    return workflowRoles.find((role) => role.role === 'scheduling') ?? null;
  }, [selectedTask?.metadata?.scheduling?.planner, workflowRoles]);
  const currentRuntimeStep = useMemo(() => {
    if (!workflowRuntime?.currentStep) {
      return null;
    }

    return selectedSteps.find((step) => step.id === workflowRuntime.currentStep) ?? null;
  }, [selectedSteps, workflowRuntime?.currentStep]);
  const currentRuntimeRoleProfile = useMemo(() => {
    if (typeof workflowRuntime?.currentAgentRole === 'string' && isWorkflowAgentRoleId(workflowRuntime.currentAgentRole)) {
      return workflowRoles.find((role) => role.role === workflowRuntime.currentAgentRole) ?? null;
    }

    if (!currentRuntimeStep) {
      return null;
    }

    const roleId = getAgentRoleId(currentRuntimeStep);
    return roleId
      ? workflowRoles.find((role) => role.role === roleId) ?? null
      : null;
  }, [currentRuntimeStep, workflowRoles, workflowRuntime?.currentAgentRole]);
  const currentRuntimeSnapshot = useMemo(() => {
    if (!currentRuntimeStep) {
      return null;
    }

    return selectedTask?.result?.outputs?.[currentRuntimeStep.id] ?? null;
  }, [currentRuntimeStep, selectedTask?.result?.outputs]);
  const currentRuntimeNotes = useMemo(
    () => buildStepRuntimeNotes(currentRuntimeSnapshot),
    [currentRuntimeSnapshot],
  );
  const stepAssignments = useMemo(() => selectedSteps.map((step) => {
    const roleId = getAgentRoleId(step);
    const roleProfile = roleId
      ? workflowRoles.find((role) => role.role === roleId) ?? null
      : null;

    return {
      step,
      roleProfile,
      actorLabel: getStepActorLabel(step, workflowRoles),
      state: getStepVisualState(step.id, selectedTask),
    };
  }), [selectedSteps, selectedTask, workflowRoles]);
  const workflowGraph = useMemo(() => {
    if (selectedSteps.length === 0) {
      return null;
    }

    const layers = buildExecutionLayers(selectedSteps);
    const nodeWidth = 244;
    const nodeHeight = 156;
    const columnGap = 84;
    const rowGap = 26;
    const paddingX = 28;
    const paddingTop = 54;
    const paddingBottom = 28;
    const maxLayerSize = Math.max(...layers.map((layer) => layer.length));
    const innerHeight = maxLayerSize * nodeHeight + Math.max(0, maxLayerSize - 1) * rowGap;
    const totalWidth = paddingX * 2 + layers.length * nodeWidth + Math.max(0, layers.length - 1) * columnGap;
    const totalHeight = paddingTop + paddingBottom + innerHeight;
    const nodes: WorkflowGraphNodeLayout[] = [];
    const nodeMap = new Map<string, WorkflowGraphNodeLayout>();

    layers.forEach((layer, layerIndex) => {
      const x = paddingX + layerIndex * (nodeWidth + columnGap);
      const layerHeight = layer.length * nodeHeight + Math.max(0, layer.length - 1) * rowGap;
      const startY = paddingTop + (innerHeight - layerHeight) / 2;

      layer.forEach((step, rowIndex) => {
        const node = {
          step,
          x,
          y: startY + rowIndex * (nodeHeight + rowGap),
        };
        nodes.push(node);
        nodeMap.set(step.id, node);
      });
    });

    const edges = selectedSteps.flatMap((step) =>
      (step.dependsOn ?? []).flatMap((dependencyId) => {
        const source = nodeMap.get(dependencyId);
        const target = nodeMap.get(step.id);

        if (!source || !target) {
          return [];
        }

        const fromX = source.x + nodeWidth;
        const fromY = source.y + nodeHeight / 2;
        const toX = target.x;
        const toY = target.y + nodeHeight / 2;
        const curve = Math.max(28, (toX - fromX) * 0.38);

        return [{
          key: `${dependencyId}->${step.id}`,
          path: `M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`,
        }];
      }),
    );

    const layerLabels = layers.map((layer, index) => ({
      key: `layer-${index + 1}`,
      x: paddingX + index * (nodeWidth + columnGap) + nodeWidth / 2,
      label: layer.length > 1 ? `第 ${index + 1} 层 · 并行 ${layer.length}` : `第 ${index + 1} 层`,
    }));

    return {
      nodeWidth,
      nodeHeight,
      totalWidth,
      totalHeight,
      nodes,
      edges,
      layerLabels,
    };
  }, [selectedSteps]);
  const referencedRoleProfiles = useMemo(() => {
    const roleIds = Array.from(new Set(
      selectedSteps
        .map((step) => getAgentRoleId(step))
        .filter((role): role is WorkflowAgentRoleId => Boolean(role)),
    ));

    return roleIds
      .map((roleId) => workflowRoles.find((role) => role.role === roleId))
      .filter((role): role is WorkflowAgentRoleProfile => Boolean(role));
  }, [selectedSteps, workflowRoles]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workflow Center</h1>
            <Badge className="border border-violet-500/20 bg-violet-500/10 text-violet-700">
              正式入口
            </Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            这里统一查看工作流任务创建、调度判断、执行进度和步骤角色，不再只依赖测试页。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/workflow/nodes">工作流节点开发</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/workflow/agents">管理 Workflow 角色</Link>
          </Button>
          <Button variant="outline" onClick={() => void loadWorkflowRoles()}>
            刷新角色配置
          </Button>
          <Button onClick={() => void loadTasks()} disabled={loading}>
            {loading ? '刷新中...' : '刷新任务'}
          </Button>
        </div>
      </div>

      <Card className="border-border/60 bg-muted/10">
        <CardHeader>
          <CardTitle>架构边界</CardTitle>
          <CardDescription>
            03 负责调度判断和 DSL 规划，06 负责调度代理/执行代理的角色定义、提示词和权限边界。这个页面把两者放到同一条正式验收路径里。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>任务总数</CardDescription>
            <CardTitle className="text-2xl">{taskStats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>进行中</CardDescription>
            <CardTitle className="text-2xl">{taskStats.active}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>工作流编排</CardDescription>
            <CardTitle className="text-2xl">{taskStats.workflow}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>简单执行</CardDescription>
            <CardTitle className="text-2xl">{taskStats.simple}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>创建工作流任务</CardTitle>
              <CardDescription>
                直接创建任务并观察系统如何决定简单执行或工作流编排，以及每个步骤绑定到哪个角色。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {QUICK_RECIPES.map((recipe) => (
                  <Button
                    key={recipe.label}
                    type="button"
                    variant="outline"
                    onClick={() => applyRecipe(recipe)}
                  >
                    {recipe.label}
                  </Button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="workflow-center-summary">任务摘要</Label>
                <Input
                  id="workflow-center-summary"
                  value={taskSummaryInput}
                  onChange={(event) => setTaskSummaryInput(event.target.value)}
                  placeholder="例如：同时打开两个页面并分别截图"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workflow-center-requirements">任务要求</Label>
                <Textarea
                  id="workflow-center-requirements"
                  rows={5}
                  value={requirementsInput}
                  onChange={(event) => setRequirementsInput(event.target.value)}
                  placeholder={'每行一条\n例如：打开页面'}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workflow-center-context">相关上下文</Label>
                <Textarea
                  id="workflow-center-context"
                  rows={4}
                  value={relevantMessagesInput}
                  onChange={(event) => setRelevantMessagesInput(event.target.value)}
                  placeholder={'每行一条\n例如：优先验证并行步骤映射是否稳定'}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workflow-center-session">会话标识</Label>
                <Input
                  id="workflow-center-session"
                  value={sessionIdInput}
                  onChange={(event) => setSessionIdInput(event.target.value)}
                  placeholder="workflow-center"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void createTask()} disabled={creating}>
                  {creating ? '创建中...' : '创建任务'}
                </Button>
                {selectedTask && ['pending', 'running'].includes(selectedTask.status) ? (
                  <Button variant="outline" onClick={() => void cancelTask()} disabled={cancelling}>
                    {cancelling ? '取消中...' : '取消当前任务'}
                  </Button>
                ) : null}
              </div>

              {actionMessage ? <p className="text-sm text-emerald-700">{actionMessage}</p> : null}
              {actionError ? <p className="text-sm text-red-700">{actionError}</p> : null}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>任务列表</CardTitle>
              <CardDescription>左侧选择任务，右侧查看调度结果、执行计划和角色运行信息。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有工作流任务</p>
              ) : (
                tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors hover:bg-muted/40 ${
                      selectedTask?.id === task.id
                        ? 'border-foreground/30 bg-muted/30'
                        : 'border-border/60'
                    }`}
                    onClick={() => void loadTaskDetail(task.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{task.summary}</span>
                      <Badge className={`border ${getStatusClassName(task.status)}`}>{task.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge className={`border ${getStrategyClassName(task.strategy)}`}>
                        {getStrategyLabel(task.strategy)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        预计耗时：{formatDuration(task.estimatedDuration)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{task.id}</p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {!selectedTask ? (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>任务详情</CardTitle>
                <CardDescription>从左侧选择一个任务后，这里会显示正式调度信息和步骤角色信息。</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>{selectedTask.summary}</CardTitle>
                  <CardDescription>任务状态、执行方式、预计耗时和运行进度。</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>状态：<span className="text-foreground">{selectedTask.status}</span></p>
                    <p>执行方式：<span className="text-foreground">{getStrategyLabel(selectedTask.metadata?.scheduling?.strategy || selectedTask.strategy)}</span></p>
                    <p>预计耗时：<span className="text-foreground">{formatDuration(selectedTask.metadata?.scheduling?.estimatedDurationSeconds || selectedTask.estimatedDuration)}</span></p>
                    <p>当前进度：<span className="text-foreground">{selectedTask.progress ?? 0}%</span></p>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>当前步骤：<span className="text-foreground">{selectedTask.metadata?.workflow?.currentStep || '暂无'}</span></p>
                    <p>当前角色：<span className="text-foreground">{selectedTask.metadata?.workflow?.currentAgentRole || '暂无'}</span></p>
                    <p>创建时间：<span className="text-foreground">{formatDateTime(selectedTask.createdAt)}</span></p>
                    <p>完成时间：<span className="text-foreground">{formatDateTime(selectedTask.completedAt)}</span></p>
                  </div>
                </CardContent>
              </Card>

              {fallbackInfo ? (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardHeader>
                    <CardTitle>实际执行说明</CardTitle>
                    <CardDescription>
                      当前任务原始上报过工作流规划，但在提交到执行引擎时发生了回退；下面展示的是实际执行结果，而不是只展示原始规划。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>实际执行方式：<span className="text-foreground">简单执行</span></p>
                    <p>回退来源：<span className="text-foreground">{fallbackInfo.source || '未提供'}</span></p>
                    <p>回退原因：<span className="text-foreground">{fallbackInfo.reason || '未提供'}</span></p>
                    {plannedSteps.length > 0 ? (
                      <p>原始规划步骤：<span className="text-foreground">{plannedSteps.map((step) => step.id).join(' -> ')}</span></p>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>03 调度判断</CardTitle>
                  <CardDescription>这里显示调度层如何判定执行方式、为什么这么判、规划产物是否校验通过，以及是否在执行前发生回退。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/10 px-4 py-4 text-muted-foreground">
                      <p>调度受理：<span className="text-foreground">{schedulingInfo?.accepted === false ? '未受理' : '已受理'}</span></p>
                      <p>初始判定：<span className="text-foreground">{getStrategyLabel(schedulingInfo?.strategy || selectedTask.strategy)}</span></p>
                      <p>当前实际执行：<span className="text-foreground">{getStrategyLabel(effectiveStrategy)}</span></p>
                      <p>规划器：<span className="text-foreground">{getPlannerGeneratorLabel(schedulingInfo?.generator)}</span></p>
                      <p>判定来源：<span className="text-foreground">{getPlannerSourceLabel(plannerInfo?.source)}</span></p>
                      <p>预计耗时：<span className="text-foreground">{formatDuration(schedulingInfo?.estimatedDurationSeconds || selectedTask.estimatedDuration)}</span></p>
                      {schedulingInfo?.message ? (
                        <p>调度备注：<span className="text-foreground">{schedulingInfo.message}</span></p>
                      ) : null}
                    </div>

                    <div className="space-y-2 rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-muted-foreground">
                      <p>复杂度：<span className="text-foreground">{plannerAnalysis?.complexity || '未提供'}</span></p>
                      <p>需要浏览器：<span className="text-foreground">{getYesNoLabel(plannerAnalysis?.needsBrowser)}</span></p>
                      <p>需要通知：<span className="text-foreground">{getYesNoLabel(plannerAnalysis?.needsNotification)}</span></p>
                      <p>需要多步：<span className="text-foreground">{getYesNoLabel(plannerAnalysis?.needsMultipleSteps)}</span></p>
                      <p>需要并行：<span className="text-foreground">{getYesNoLabel(plannerAnalysis?.needsParallel)}</span></p>
                      {plannerInfo?.model ? (
                        <p>规划模型：<span className="text-foreground">{plannerInfo.model}</span></p>
                      ) : null}
                      {plannerAnalysis?.detectedUrls?.length ? (
                        <p>目标页面：<span className="text-foreground">{plannerAnalysis.detectedUrls.join('、')}</span></p>
                      ) : plannerAnalysis?.detectedUrl ? (
                        <p>目标页面：<span className="text-foreground">{plannerAnalysis.detectedUrl}</span></p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">调度解释</p>
                    <p className="mt-2 whitespace-pre-wrap">{plannerInfo?.reason || '未提供'}</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-muted-foreground">
                      <p className="text-sm font-medium text-foreground">规划产物校验</p>
                      <div className="mt-2 space-y-2">
                        <p>校验结果：<span className="text-foreground">{planningValidation?.valid === false ? '未通过' : '已通过'}</span></p>
                        {workflowManifest?.workflowName || workflowManifest?.workflowVersion ? (
                          <p>
                            产物标识：
                            <span className="text-foreground">
                              {workflowManifest?.workflowName || 'workflow'}@{workflowManifest?.workflowVersion || '未提供'}
                            </span>
                          </p>
                        ) : null}
                        {workflowManifest?.stepIds?.length ? (
                          <p>规划步骤数：<span className="text-foreground">{workflowManifest.stepIds.length}</span></p>
                        ) : null}
                        {workflowManifest?.stepTypes?.length ? (
                          <p>步骤类型：<span className="text-foreground">{workflowManifest.stepTypes.join('、')}</span></p>
                        ) : null}
                        {workflowManifest?.dslVersion ? (
                          <p>DSL 版本：<span className="text-foreground">{workflowManifest.dslVersion}</span></p>
                        ) : null}
                        {planningValidation?.errors?.length ? (
                          <p>校验问题：<span className="text-foreground">{planningValidation.errors.join(' | ')}</span></p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-muted-foreground">
                      <p className="text-sm font-medium text-foreground">模型分析与回退</p>
                      <div className="mt-2 space-y-2">
                        <p>是否尝试模型分析：<span className="text-foreground">{plannerDiagnostics?.llmAttempted ? '是' : '否'}</span></p>
                        {plannerDiagnostics?.llmAttempted ? (
                          <>
                            <p>模型分析尝试次数：<span className="text-foreground">{plannerDiagnostics.llmAttempts || 0}</span></p>
                            <p>模型超时：<span className="text-foreground">{plannerDiagnostics.llmTimeoutMs || '未提供'} ms</span></p>
                            {plannerDiagnostics.fallbackUsed ? (
                              <p>分析回退方式：<span className="text-foreground">{plannerDiagnostics.fallbackUsed}</span></p>
                            ) : null}
                            {plannerDiagnostics.fallbackReason ? (
                              <p>分析回退说明：<span className="text-foreground">{plannerDiagnostics.fallbackReason}</span></p>
                            ) : null}
                            {plannerDiagnostics.llmErrors?.length ? (
                              <p>分析失败记录：<span className="text-foreground">{plannerDiagnostics.llmErrors.join(' | ')}</span></p>
                            ) : null}
                          </>
                        ) : plannerDiagnostics?.llmSkippedReason ? (
                          <p>未使用模型分析原因：<span className="text-foreground">{plannerDiagnostics.llmSkippedReason}</span></p>
                        ) : null}
                        {fallbackInfo ? (
                          <>
                            <p>执行前回退来源：<span className="text-foreground">{fallbackInfo.source || '未提供'}</span></p>
                            <p>执行前回退原因：<span className="text-foreground">{fallbackInfo.reason || '未提供'}</span></p>
                            {fallbackInfo.errors?.length ? (
                              <p>执行前回退记录：<span className="text-foreground">{fallbackInfo.errors.join(' | ')}</span></p>
                            ) : null}
                          </>
                        ) : (
                          <p>执行前回退：<span className="text-foreground">未发生</span></p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4 text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">原始规划步骤</p>
                    <div className="mt-2 space-y-2">
                      {plannedSteps.length > 0 ? (
                        plannedSteps.map((step) => (
                          <div key={`planned-${step.id}`} className="rounded-xl border border-border/50 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{step.id}</span>
                              <Badge className={`border ${getStepTypeClassName(step.type)}`}>{getStepTypeLabel(step.type)}</Badge>
                            </div>
                            <div className="mt-2 space-y-1 text-sm">
                              <p>前置步骤：<span className="text-foreground">{step.dependsOn?.length ? step.dependsOn.join('、') : '无'}</span></p>
                              <p>角色/能力：<span className="text-foreground">{getStepActorLabel(step, workflowRoles)}</span></p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p>本次任务没有生成多步规划，调度层直接选择了简单执行。</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>工作流视图</CardTitle>
                  <CardDescription>这里把当前任务的实际执行链路画成流程图，复杂流程、并行步骤和依赖关系会更直观。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {workflowGraph ? (
                    <>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge className={`border ${getStepVisualClassName('done')}`}>已完成</Badge>
                        <Badge className={`border ${getStepVisualClassName('running')}`}>执行中</Badge>
                        <Badge className={`border ${getStepVisualClassName('skipped')}`}>已跳过</Badge>
                        <Badge className={`border ${getStepVisualClassName('pending')}`}>待执行</Badge>
                        <Badge className={`border ${getStepVisualClassName('failed')}`}>失败</Badge>
                      </div>
                      <div className="overflow-x-auto pb-2">
                        <div
                          className="relative rounded-3xl border border-border/60 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.08),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.08),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.9),_rgba(255,255,255,0.96))]"
                          style={{
                            width: `${Math.max(workflowGraph.totalWidth, 760)}px`,
                            minHeight: `${workflowGraph.totalHeight}px`,
                          }}
                        >
                          <svg
                            className="absolute inset-0 h-full w-full"
                            viewBox={`0 0 ${Math.max(workflowGraph.totalWidth, 760)} ${workflowGraph.totalHeight}`}
                            aria-hidden="true"
                          >
                            <defs>
                              <marker
                                id="workflow-arrow"
                                markerWidth="10"
                                markerHeight="10"
                                refX="7"
                                refY="3"
                                orient="auto"
                                markerUnits="strokeWidth"
                              >
                                <path d="M0,0 L0,6 L8,3 z" className="fill-slate-400" />
                              </marker>
                            </defs>
                            {workflowGraph.edges.map((edge) => (
                              <path
                                key={edge.key}
                                d={edge.path}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="text-slate-300"
                                markerEnd="url(#workflow-arrow)"
                              />
                            ))}
                          </svg>

                          {workflowGraph.layerLabels.map((layer) => (
                            <div
                              key={layer.key}
                              className="absolute -translate-x-1/2 rounded-full border border-border/60 bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm"
                              style={{ left: `${layer.x}px`, top: '16px' }}
                            >
                              {layer.label}
                            </div>
                          ))}

                          {workflowGraph.nodes.map((node) => {
                            const stepState = getStepVisualState(node.step.id, selectedTask);
                            const actorLabel = getStepActorLabel(node.step, workflowRoles);

                            return (
                              <div
                                key={`${selectedTask.id}-${node.step.id}`}
                                className="absolute rounded-3xl border border-border/70 bg-background/95 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.08)]"
                                style={{
                                  left: `${node.x}px`,
                                  top: `${node.y}px`,
                                  width: `${workflowGraph.nodeWidth}px`,
                                  minHeight: `${workflowGraph.nodeHeight}px`,
                                }}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">{node.step.id}</span>
                                  <Badge className={`border ${getStepVisualClassName(stepState)}`}>
                                    {getStepVisualLabel(stepState)}
                                  </Badge>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <Badge className={`border ${getStepTypeClassName(node.step.type)}`}>
                                    {getStepTypeLabel(node.step.type)}
                                  </Badge>
                                  <Badge variant="outline">{actorLabel}</Badge>
                                </div>
                                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                                  <p>
                                    前置步骤：
                                    {node.step.dependsOn?.length ? node.step.dependsOn.join('、') : '无'}
                                  </p>
                                  <p>
                                    分支形态：
                                    {node.step.dependsOn && node.step.dependsOn.length > 1 ? '汇聚节点' : '顺序节点'}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">当前任务还没有可展示的工作流结构。</p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>03 / 06 角色与运行边界</CardTitle>
                  <CardDescription>这里把调度时使用的规划角色、当前运行中的角色，以及任务内每一步的角色分配放在同一页，方便按正式 UI 验收。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {planningRoleProfile ? (
                    <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border border-sky-500/20 bg-sky-500/10 text-sky-700">规划角色</Badge>
                        <span className="text-sm font-medium text-foreground">{planningRoleProfile.shortLabel}</span>
                        <Badge variant="outline">{planningRoleProfile.roleName}</Badge>
                        <Badge variant="outline">{planningRoleProfile.agentType}</Badge>
                        {planningRoleProfile.hasOverrides ? <Badge variant="outline">已自定义</Badge> : null}
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <p>规划来源：{getPlannerSourceLabel(selectedTask.metadata?.scheduling?.planner?.source)}</p>
                        <p>规划原因：{selectedTask.metadata?.scheduling?.planner?.reason || '未提供'}</p>
                        {selectedTask.metadata?.scheduling?.planner?.model ? (
                          <p>规划模型：{selectedTask.metadata.scheduling.planner.model}</p>
                        ) : null}
                        <p>正式工具：{planningRoleProfile.tools.length ? planningRoleProfile.tools.join('、') : '未提供'}</p>
                        {typeof planningRoleProfile.plannerTimeoutMs === 'number' ? (
                          <p>超时上限：{planningRoleProfile.plannerTimeoutMs} ms</p>
                        ) : null}
                        {typeof planningRoleProfile.plannerMaxRetries === 'number' ? (
                          <p>最大重试：{planningRoleProfile.plannerMaxRetries}</p>
                        ) : null}
                        {getRoleBoundaryNote(planningRoleProfile) ? (
                          <p>边界说明：{getRoleBoundaryNote(planningRoleProfile)}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border border-amber-500/20 bg-amber-500/10 text-amber-700">当前运行角色</Badge>
                      <span className="text-sm font-medium text-foreground">
                        {currentRuntimeRoleProfile
                          ? currentRuntimeRoleProfile.shortLabel
                          : currentRuntimeStep
                            ? getStepActorLabel(currentRuntimeStep, workflowRoles)
                            : '暂无'}
                      </span>
                      {currentRuntimeRoleProfile ? <Badge variant="outline">{currentRuntimeRoleProfile.roleName}</Badge> : null}
                      {currentRuntimeRoleProfile?.hasOverrides ? <Badge variant="outline">已自定义</Badge> : null}
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      <p>当前动作：{workflowRuntime?.currentStep || '暂无'}</p>
                        <p>运行状态：{workflowRuntime?.status || selectedTask.status}</p>
                        {currentRuntimeRoleProfile ? (
                          <>
                            <p>正式工具：{currentRuntimeRoleProfile.tools.length ? currentRuntimeRoleProfile.tools.join('、') : '未提供'}</p>
                          {typeof currentRuntimeRoleProfile.concurrencyLimit === 'number' ? (
                            <p>并发上限：{currentRuntimeRoleProfile.concurrencyLimit}</p>
                          ) : null}
                          {currentRuntimeRoleProfile.memoryPolicy ? (
                            <p>记忆策略：{currentRuntimeRoleProfile.memoryPolicy}</p>
                          ) : null}
                          {currentRuntimeRoleProfile.capabilityTags?.length ? (
                            <p>能力标签：{currentRuntimeRoleProfile.capabilityTags.join('、')}</p>
                          ) : null}
                          {getRoleBoundaryNote(currentRuntimeRoleProfile) ? (
                            <p>边界说明：{getRoleBoundaryNote(currentRuntimeRoleProfile)}</p>
                          ) : null}
                        </>
                      ) : currentRuntimeStep?.type === 'browser' ? (
                        <p>边界说明：当前步骤由系统浏览器能力执行，不通过代理越权。</p>
                      ) : currentRuntimeStep?.type === 'notification' ? (
                        <p>边界说明：当前步骤由系统通知能力执行，不通过代理越权。</p>
                      ) : currentRuntimeStep?.type === 'capability' ? (
                        <p>边界说明：当前步骤由已发布代码节点执行，按能力 ID 调用，不通过通用代理越权。</p>
                      ) : (
                        <p>边界说明：当前还没有进入可识别的运行角色。</p>
                      )}
                    </div>
                    {currentRuntimeStep ? (
                      <div className="mt-3 rounded-2xl border border-border/50 bg-muted/20 px-3 py-3">
                        <p className="text-sm font-medium text-foreground">当前会话与资源</p>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {currentRuntimeNotes.length > 0 ? (
                            currentRuntimeNotes.map((note) => (
                              <p key={`current-runtime-${note}`}>{note}</p>
                            ))
                          ) : (
                            <p>当前步骤尚未回写更细的会话、记忆槽或隔离目录信息。</p>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">任务内角色分配</p>
                        <p className="text-sm text-muted-foreground">逐步展示当前任务每一步绑定到哪个正式角色或系统能力。</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
                      {stepAssignments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">当前任务没有可展示的角色分配。</p>
                      ) : (
                        stepAssignments.map(({ step, roleProfile, actorLabel, state }) => (
                          <div key={`assignment-${step.id}`} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{step.id}</span>
                              <Badge className={`border ${getStepVisualClassName(state)}`}>{getStepVisualLabel(state)}</Badge>
                              <Badge className={`border ${getStepTypeClassName(step.type)}`}>{getStepTypeLabel(step.type)}</Badge>
                              <Badge variant="outline">{actorLabel}</Badge>
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                              <p>依赖关系：{step.dependsOn?.length ? step.dependsOn.join('、') : '无前置步骤'}</p>
                              {roleProfile ? (
                                <>
                                  <p>正式角色：{roleProfile.roleName}</p>
                                  <p>正式工具：{roleProfile.tools.length ? roleProfile.tools.join('、') : '未提供'}</p>
                                  {typeof roleProfile.concurrencyLimit === 'number' ? <p>并发上限：{roleProfile.concurrencyLimit}</p> : null}
                                  {roleProfile.memoryPolicy ? <p>记忆策略：{roleProfile.memoryPolicy}</p> : null}
                                  {roleProfile.capabilityTags?.length ? <p>能力标签：{roleProfile.capabilityTags.join('、')}</p> : null}
                                </>
                              ) : step.type === 'browser' ? (
                                <p>边界说明：浏览器副作用由系统 browser step 执行。</p>
                              ) : step.type === 'notification' ? (
                                <p>边界说明：通知副作用由系统 notification step 执行。</p>
                              ) : step.type === 'capability' ? (
                                <p>边界说明：该步骤直接调用已发布代码节点，不通过通用代理执行。</p>
                              ) : (
                                <p>边界说明：当前没有匹配到正式角色定义。</p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-medium text-foreground">任务内正式角色快照</p>
                    {referencedRoleProfiles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">当前任务没有引用到显式代理角色，或仍是简单执行。</p>
                    ) : (
                      referencedRoleProfiles.map((role) => (
                        <div key={role.role} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{role.shortLabel}</span>
                            <Badge variant="outline">{role.roleName}</Badge>
                            <Badge variant="outline">{role.agentType}</Badge>
                            {role.hasOverrides ? <Badge variant="outline">已自定义</Badge> : null}
                          </div>
                          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                            <p>{role.description}</p>
                            <p>允许工具：{role.tools.length ? role.tools.join('、') : '未提供'}</p>
                            {typeof role.concurrencyLimit === 'number' ? <p>并发上限：{role.concurrencyLimit}</p> : null}
                            {role.memoryPolicy ? <p>记忆策略：{role.memoryPolicy}</p> : null}
                            {role.capabilityTags?.length ? <p>能力标签：{role.capabilityTags.join('、')}</p> : null}
                            {getRoleBoundaryNote(role) ? <p>边界说明：{getRoleBoundaryNote(role)}</p> : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <Button variant="outline" asChild>
                    <Link href="/workflow/agents">打开正式角色配置</Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>运行态详情</CardTitle>
                  <CardDescription>这里展示本次任务真实执行时的当前动作、跳过情况、失败或取消原因，便于按产品界面验收执行代理层。</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>实际状态：<span className="text-foreground">{workflowRuntime?.status || selectedTask.status}</span></p>
                    <p>当前动作：<span className="text-foreground">{workflowRuntime?.currentStep || '暂无'}</span></p>
                    <p>当前角色：<span className="text-foreground">{workflowRuntime?.currentAgentRole || '暂无'}</span></p>
                    <p>已完成步骤：<span className="text-foreground">{totalStepCount > 0 ? `${completedStepCount} / ${totalStepCount}` : completedStepCount}</span></p>
                    <p>运行中步骤：<span className="text-foreground">{runningSteps.length ? runningSteps.join('、') : '无'}</span></p>
                    <p>已跳过步骤：<span className="text-foreground">{skippedSteps.length ? skippedSteps.join('、') : '无'}</span></p>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>开始时间：<span className="text-foreground">{formatDateTime(workflowRuntime?.startedAt || selectedTask.startedAt)}</span></p>
                    <p>最近更新时间：<span className="text-foreground">{formatDateTime(workflowRuntime?.updatedAt)}</span></p>
                    <p>结束时间：<span className="text-foreground">{formatDateTime(workflowRuntime?.completedAt || selectedTask.completedAt)}</span></p>
                    {runtimeError?.message ? (
                      <p>失败原因：<span className="text-foreground">{runtimeError.message}</span></p>
                    ) : null}
                    {runtimeError?.code ? (
                      <p>错误标识：<span className="text-foreground">{runtimeError.code}</span></p>
                    ) : null}
                    {workflowRuntime?.cancelReason || selectedTask.metadata?.cancelReason ? (
                      <p>取消原因：<span className="text-foreground">{workflowRuntime?.cancelReason || selectedTask.metadata?.cancelReason}</span></p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>最终输出</CardTitle>
                  <CardDescription>这里展示本次任务真实执行得到的结果，而不是原始规划草案。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {outputEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">当前任务还没有可展示输出。</p>
                  ) : (
                    outputEntries.map((entry) => (
                      <div key={`${selectedTask.id}-${entry.stepId}`} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{entry.stepId}</span>
                          <Badge className={`border ${entry.success ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : 'bg-red-500/10 text-red-700 border-red-500/20'}`}>
                            {entry.success ? '成功' : '失败'}
                          </Badge>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{entry.text}</p>
                        {entry.error ? <p className="mt-2 text-xs text-red-700">{entry.error}</p> : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>执行计划与步骤角色</CardTitle>
                  <CardDescription>这里展示当前任务的实际执行步骤、每一步的真实状态，以及关键结果或失败原因；如果任务已回退为简单执行，会显示真实执行的单步代理而不是原始多步规划。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedSteps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">当前任务没有工作流步骤，通常表示它被判定为简单执行。</p>
                  ) : (
                    selectedSteps.map((step) => {
                      const stepState = getStepVisualState(step.id, selectedTask);
                      const snapshot = selectedTask?.result?.outputs?.[step.id] || null;
                      const stepOutputRecord = snapshot?.output && isRecord(snapshot.output) ? snapshot.output : null;
                      const runtimeNotes = buildStepRuntimeNotes(snapshot);
                      const stepOutputText = snapshot?.output ? extractPreferredOutputText(snapshot.output) : null;
                      const screenshotPath = (
                        stepOutputRecord && typeof stepOutputRecord.screenshotPath === 'string' && stepOutputRecord.screenshotPath.trim()
                      ) ? stepOutputRecord.screenshotPath.trim() : null;
                      const detailArtifactPath = (
                        stepOutputRecord && typeof stepOutputRecord.detailArtifactPath === 'string' && stepOutputRecord.detailArtifactPath.trim()
                      ) ? stepOutputRecord.detailArtifactPath.trim() : null;
                      const roleId = getAgentRoleId(step);
                      const roleProfile = roleId
                        ? workflowRoles.find((role) => role.role === roleId)
                        : null;

                      return (
                        <div key={step.id} className="rounded-2xl border border-border/60 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{step.id}</span>
                              <Badge className={`border ${getStepVisualClassName(stepState)}`}>
                                {getStepVisualLabel(stepState)}
                              </Badge>
                              <Badge className={`border ${getStepTypeClassName(step.type)}`}>{getStepTypeLabel(step.type)}</Badge>
                            </div>
                            {roleProfile ? (
                              <Badge variant="outline">{roleProfile.shortLabel}</Badge>
                            ) : step.type === 'browser' ? (
                              <Badge variant="outline">系统浏览器能力</Badge>
                            ) : step.type === 'notification' ? (
                              <Badge variant="outline">系统通知能力</Badge>
                            ) : step.type === 'capability' ? (
                              <Badge variant="outline">系统能力节点</Badge>
                            ) : null}
                          </div>

                          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                            <p>
                              依赖关系：
                              {step.dependsOn?.length ? step.dependsOn.join('、') : '无前置步骤'}
                            </p>
                            <p>实际状态：{getStepVisualLabel(stepState)}</p>
                            {roleProfile ? (
                              <>
                                <p>角色类型：{roleProfile.roleName}</p>
                                <p>运行时工具：{roleProfile.tools.length ? roleProfile.tools.join('、') : '未提供'}</p>
                                {typeof roleProfile.concurrencyLimit === 'number' ? <p>并发上限：{roleProfile.concurrencyLimit}</p> : null}
                                {roleProfile.memoryPolicy ? <p>记忆策略：{roleProfile.memoryPolicy}</p> : null}
                                {roleProfile.capabilityTags?.length ? <p>能力标签：{roleProfile.capabilityTags.join('、')}</p> : null}
                                {getRoleBoundaryNote(roleProfile) ? <p>边界说明：{getRoleBoundaryNote(roleProfile)}</p> : null}
                              </>
                            ) : step.type === 'browser' ? (
                              <p>说明：浏览器副作用由专门 browser step 执行，不通过代理越权。</p>
                            ) : step.type === 'notification' ? (
                              <p>说明：通知副作用由专门 notification step 执行，不通过代理越权。</p>
                            ) : step.type === 'capability' ? (
                              <p>说明：当前步骤直接执行已发布代码节点，输入参数来自调度层生成的结构化对象。</p>
                            ) : null}
                            {stepOutputText ? (
                              <p>关键结果：{truncateText(stepOutputText)}</p>
                            ) : null}
                            {snapshot?.error ? (
                              <p className="text-red-700">失败原因：{snapshot.error}</p>
                            ) : null}
                            {runtimeNotes.map((note) => (
                              <p key={`${step.id}-${note}`}>{note}</p>
                            ))}
                          </div>

                          {screenshotPath ? (
                            <div className="mt-4 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={buildRawFileUrl(screenshotPath)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
                                >
                                  打开截图文件
                                </a>
                                {detailArtifactPath ? (
                                  <a
                                    href={buildRawFileUrl(detailArtifactPath)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
                                  >
                                    打开详细结果
                                  </a>
                                ) : null}
                              </div>

                              {isImageFilePath(screenshotPath) ? (
                                <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/10">
                                  <Image
                                    src={buildRawFileUrl(screenshotPath)}
                                    alt={`${step.id} screenshot`}
                                    width={1440}
                                    height={960}
                                    unoptimized
                                    className="max-h-[320px] w-full object-contain"
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : detailArtifactPath ? (
                            <div className="mt-4">
                              <a
                                href={buildRawFileUrl(detailArtifactPath)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
                              >
                                打开详细结果
                              </a>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>任务要求</CardTitle>
                  <CardDescription>保留原始需求，方便对照调度判断和步骤分解。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedTask.requirements?.length ? (
                    selectedTask.requirements.map((requirement, index) => (
                      <p key={`${selectedTask.id}-requirement-${index}`} className="text-sm text-foreground">
                        {index + 1}. {requirement}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">未提供</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
