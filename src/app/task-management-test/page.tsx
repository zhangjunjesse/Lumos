'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Task {
  id: string;
  summary: string;
  status: string;
  progress?: number;
  estimatedDuration?: number;
  strategy?: 'simple' | 'workflow';
  createdAt: string;
}

interface TaskDetail extends Task {
  requirements?: string[];
  startedAt?: string;
  completedAt?: string;
  metadata?: {
    scheduling?: {
      strategy?: 'simple' | 'workflow';
      estimatedDurationSeconds?: number;
      planner?: {
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
        diagnostics?: {
          llmAttempted?: boolean;
          llmAttempts?: number;
          llmErrors?: string[];
          llmTimeoutMs?: number;
          llmSkippedReason?: string;
          fallbackUsed?: 'heuristic-preview';
          fallbackReason?: string;
        };
      };
      workflowDsl?: {
        steps?: Array<{
          id: string;
          type: 'agent' | 'browser' | 'notification';
          dependsOn?: string[];
        }>;
      };
    };
    workflow?: {
      workflowId?: string;
      simpleExecutionId?: string;
      progress?: number;
      currentStep?: string;
      completedSteps?: string[];
    };
  };
}

export default function TaskManagementTestPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [taskSummaryInput, setTaskSummaryInput] = useState('输出一句简短摘要');
  const [requirementsInput, setRequirementsInput] = useState('一句话即可');
  const [relevantMessagesInput, setRelevantMessagesInput] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('task-management-test-ui');

  const taskTemplates = [
    {
      label: '简单执行',
      summary: '输出一句简短摘要',
      requirements: ['一句话即可'],
      relevantMessages: [],
    },
    {
      label: '浏览器流程',
      summary: '打开 https://example.com 并截图，然后通知我',
      requirements: ['打开页面', '截图', '通知结果'],
      relevantMessages: ['这是一个用于验证工作流调度的浏览器任务。'],
    },
    {
      label: '并行浏览器',
      summary: '同时打开 https://example.com 和 https://openai.com 并分别截图，然后通知我',
      requirements: ['同时打开两个页面', '分别截图', '通知结果'],
      relevantMessages: ['这个任务用于验证并行浏览器调度。'],
    },
  ] as const;

  const loadTasks = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/task-management/tasks');
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTaskDetail = async (taskId: string) => {
    try {
      const response = await fetch(`/api/task-management/tasks/${taskId}`);
      const data = await response.json();
      setSelectedTask(data.task);
    } catch (error) {
      console.error('Failed to load task detail:', error);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (!selectedTask?.id || !selectedTask.status || ['completed', 'failed', 'cancelled'].includes(selectedTask.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTaskDetail(selectedTask.id);
      void loadTasks();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [selectedTask?.id, selectedTask?.status]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-slate-500/10 text-slate-700';
      case 'running': return 'bg-blue-500/10 text-blue-700';
      case 'completed': return 'bg-emerald-500/10 text-emerald-700';
      case 'failed': return 'bg-red-500/10 text-red-700';
      case 'cancelled': return 'bg-slate-500/10 text-slate-700';
      default: return 'bg-slate-500/10 text-slate-700';
    }
  };

  const getStrategyLabel = (strategy?: 'simple' | 'workflow') => {
    if (strategy === 'simple') return '简单执行';
    if (strategy === 'workflow') return '工作流';
    return '待定';
  };

  const getStrategyColor = (strategy?: 'simple' | 'workflow') => {
    if (strategy === 'simple') return 'bg-amber-500/10 text-amber-700';
    if (strategy === 'workflow') return 'bg-violet-500/10 text-violet-700';
    return 'bg-slate-500/10 text-slate-700';
  };

  const getPlannerSourceLabel = (source?: 'heuristic' | 'llm') => {
    if (source === 'llm') return '模型分析';
    if (source === 'heuristic') return '规则预判';
    return '未知';
  };

  const getStepTypeLabel = (type: 'agent' | 'browser' | 'notification') => {
    switch (type) {
      case 'agent':
        return '代理执行';
      case 'browser':
        return '浏览器操作';
      case 'notification':
        return '通知发送';
      default:
        return type;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '未提供';
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return remainSeconds > 0 ? `${minutes} 分 ${remainSeconds} 秒` : `${minutes} 分钟`;
  };

  const renderStepDependencies = (dependsOn?: string[]) => {
    if (!dependsOn || dependsOn.length === 0) {
      return '无前置步骤';
    }

    return `依赖：${dependsOn.join('、')}`;
  };

  const applyTemplate = (template: typeof taskTemplates[number]) => {
    setTaskSummaryInput(template.summary);
    setRequirementsInput(template.requirements.join('\n'));
    setRelevantMessagesInput(template.relevantMessages.join('\n'));
    setCreateError(null);
    setActionMessage(`已套用样例：${template.label}`);
  };

  const createTaskFromForm = async () => {
    const summary = taskSummaryInput.trim();
    const requirements = requirementsInput
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const relevantMessages = relevantMessagesInput
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const sessionId = sessionIdInput.trim() || `task-management-test-ui-${Date.now()}`;

    if (!summary) {
      setCreateError('请先填写任务摘要');
      return;
    }

    if (requirements.length === 0) {
      setCreateError('请至少填写一条任务要求');
      return;
    }

    setCreating(true);
    setCreateError(null);
    setActionMessage(null);

    try {
      const response = await fetch('/api/task-management/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        throw new Error(data.error || '创建任务失败');
      }

      setSessionIdInput(typeof data.sessionId === 'string' && data.sessionId.trim() ? data.sessionId : sessionId);
      setActionMessage(`任务已创建：${data.taskId}`);
      await loadTasks();
      await loadTaskDetail(data.taskId);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '创建任务失败');
    } finally {
      setCreating(false);
    }
  };

  const cancelSelectedTask = async () => {
    if (!selectedTask?.id) {
      return;
    }

    setCancelling(true);
    setCreateError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/task-management/${selectedTask.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'task-management-test-ui',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '取消任务失败');
      }

      setActionMessage(data.message || '已发送取消请求');
      await loadTasks();
      await loadTaskDetail(selectedTask.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '取消任务失败');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Task Management 测试</h1>
        <Button onClick={loadTasks} disabled={loading}>
          {loading ? '加载中...' : '刷新任务列表'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>测试说明</CardTitle>
          <CardDescription>
            这个页面现在可以直接创建调度测试任务，适合验收：
            简单执行、浏览器工作流、并行浏览器工作流、调度回退信息，以及取消链路。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            正式产品入口已新增到
            {' '}
            <Link href="/workflow" className="font-medium text-foreground underline underline-offset-4">
              Workflow Center
            </Link>
            ，这里保留为辅助测试页。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>创建测试任务</CardTitle>
          <CardDescription>
            直接从这里创建任务，然后观察系统如何判断执行方式、预计耗时、计划步骤和执行进度。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {taskTemplates.map((template) => (
              <Button
                key={template.label}
                type="button"
                variant="outline"
                onClick={() => applyTemplate(template)}
              >
                {template.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="task-summary">任务摘要</Label>
              <Input
                id="task-summary"
                value={taskSummaryInput}
                onChange={(event) => setTaskSummaryInput(event.target.value)}
                placeholder="例如：同时打开两个页面并分别截图"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-requirements">任务要求</Label>
              <Textarea
                id="task-requirements"
                value={requirementsInput}
                onChange={(event) => setRequirementsInput(event.target.value)}
                placeholder={'每行一条\n例如：打开页面'}
                rows={5}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-context">相关上下文</Label>
              <Textarea
                id="task-context"
                value={relevantMessagesInput}
                onChange={(event) => setRelevantMessagesInput(event.target.value)}
                placeholder={'每行一条\n例如：优先看并行执行是否成立'}
                rows={5}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="task-session-id">测试会话标识</Label>
              <Input
                id="task-session-id"
                value={sessionIdInput}
                onChange={(event) => setSessionIdInput(event.target.value)}
                placeholder="task-management-test-ui"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={createTaskFromForm} disabled={creating}>
              {creating ? '创建中...' : '创建测试任务'}
            </Button>
            {selectedTask && ['pending', 'running'].includes(selectedTask.status) ? (
              <Button variant="outline" onClick={cancelSelectedTask} disabled={cancelling}>
                {cancelling ? '取消中...' : '取消当前任务'}
              </Button>
            ) : null}
          </div>
          {actionMessage ? (
            <p className="text-sm text-emerald-700">{actionMessage}</p>
          ) : null}
          {createError ? (
            <p className="text-sm text-red-700">{createError}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>任务列表 ({tasks.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无任务</p>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                  onClick={() => loadTaskDetail(task.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{task.summary}</span>
                    <Badge className={getStatusColor(task.status)}>
                      {task.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={getStrategyColor(task.strategy)}>
                      {getStrategyLabel(task.strategy)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      预计耗时：{formatDuration(task.estimatedDuration)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ID: {task.id}
                  </div>
                  {task.progress !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      进度: {task.progress}%
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>任务详情</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTask ? (
              <p className="text-sm text-muted-foreground">点击左侧任务查看详情</p>
            ) : (
              <div className="space-y-4">
                {selectedTask.progress !== undefined && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">当前进度</p>
                    <p className="text-sm">{selectedTask.progress}%</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">任务摘要</p>
                  <p className="text-sm">{selectedTask.summary}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">状态</p>
                  <Badge className={getStatusColor(selectedTask.status)}>
                    {selectedTask.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">执行方式</p>
                  <div className="flex items-center gap-2">
                    <Badge className={getStrategyColor(selectedTask.metadata?.scheduling?.strategy || selectedTask.strategy)}>
                      {getStrategyLabel(selectedTask.metadata?.scheduling?.strategy || selectedTask.strategy)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      预计耗时：{formatDuration(
                        selectedTask.metadata?.scheduling?.estimatedDurationSeconds
                        || selectedTask.estimatedDuration
                      )}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">需求列表</p>
                  <ul className="text-sm space-y-1">
                    {selectedTask.requirements?.map((req: string, i: number) => (
                      <li key={i}>• {req}</li>
                    ))}
                  </ul>
                </div>
                {selectedTask.metadata?.scheduling?.planner && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">调度判断</p>
                    <div className="space-y-1 text-sm">
                      <p>来源：{getPlannerSourceLabel(selectedTask.metadata.scheduling.planner.source)}</p>
                      <p>原因：{selectedTask.metadata.scheduling.planner.reason || '未提供'}</p>
                      <p>
                        复杂度：
                        {selectedTask.metadata.scheduling.planner.analysis?.complexity || '未提供'}
                      </p>
                      <p>
                        并行执行：
                        {selectedTask.metadata.scheduling.planner.analysis?.needsParallel ? '是' : '否'}
                      </p>
                      {selectedTask.metadata.scheduling.planner.analysis?.detectedUrl && (
                        <p>目标页面：{selectedTask.metadata.scheduling.planner.analysis.detectedUrl}</p>
                      )}
                      {selectedTask.metadata.scheduling.planner.analysis?.detectedUrls?.length ? (
                        <p>
                          目标页面列表：
                          {selectedTask.metadata.scheduling.planner.analysis.detectedUrls.join('、')}
                        </p>
                      ) : null}
                      {selectedTask.metadata.scheduling.planner.diagnostics?.llmAttempted ? (
                        <div className="pt-2 text-xs text-muted-foreground space-y-1">
                          <p>
                            模型分析尝试次数：
                            {selectedTask.metadata.scheduling.planner.diagnostics.llmAttempts || 0}
                          </p>
                          {selectedTask.metadata.scheduling.planner.diagnostics.fallbackReason && (
                            <p>
                              回退说明：
                              {selectedTask.metadata.scheduling.planner.diagnostics.fallbackReason}
                            </p>
                          )}
                          {selectedTask.metadata.scheduling.planner.diagnostics.llmErrors?.length ? (
                            <p>
                              失败记录：
                              {selectedTask.metadata.scheduling.planner.diagnostics.llmErrors.join(' | ')}
                            </p>
                          ) : null}
                        </div>
                      ) : selectedTask.metadata.scheduling.planner.diagnostics?.llmSkippedReason ? (
                        <div className="pt-2 text-xs text-muted-foreground space-y-1">
                          <p>
                            未使用模型分析原因：
                            {selectedTask.metadata.scheduling.planner.diagnostics.llmSkippedReason}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                {selectedTask.metadata?.workflow && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">执行跟踪</p>
                    <div className="space-y-1 text-sm">
                      <p>当前环节：{selectedTask.metadata.workflow.currentStep || '暂无'}</p>
                      <p>
                        已完成环节：
                        {selectedTask.metadata.workflow.completedSteps?.length
                          ? selectedTask.metadata.workflow.completedSteps.join('、')
                          : '暂无'}
                      </p>
                      {selectedTask.metadata.workflow.workflowId && (
                        <p>工作流运行标识：{selectedTask.metadata.workflow.workflowId}</p>
                      )}
                    </div>
                  </div>
                )}
                {selectedTask.metadata?.scheduling?.workflowDsl?.steps?.length ? (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">执行计划</p>
                    <div className="space-y-2">
                      {selectedTask.metadata.scheduling.workflowDsl.steps.map((step) => (
                        <div key={step.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{step.id}</span>
                            <Badge className="bg-sky-500/10 text-sky-700">
                              {getStepTypeLabel(step.type)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {renderStepDependencies(step.dependsOn)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">创建时间</p>
                  <p className="text-sm">{new Date(selectedTask.createdAt).toLocaleString()}</p>
                </div>
                {selectedTask.startedAt && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">开始时间</p>
                    <p className="text-sm">{new Date(selectedTask.startedAt).toLocaleString()}</p>
                  </div>
                )}
                {selectedTask.completedAt && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">完成时间</p>
                    <p className="text-sm">{new Date(selectedTask.completedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
