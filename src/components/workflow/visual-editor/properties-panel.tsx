'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeModeEditor } from '@/components/workflow/CodeModeEditor';
import {
  WorkflowKnowledgePanel,
  type WorkflowKnowledgeConfigDraft,
} from '@/components/workflow/WorkflowKnowledgePanel';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import type { NodeOnError, WorkflowNode } from '@/lib/workflow/types-v3';
import { BodyManager, type BodyChildInfo } from './body-manager';
import { ParallelBranchManager } from './parallel-branch-manager';

interface AgentPreset { id: string; name: string; description?: string }

function readKnowledge(raw: unknown): WorkflowKnowledgeConfigDraft {
  const src = (raw ?? {}) as Partial<WorkflowKnowledgeConfigDraft>;
  return {
    enabled: Boolean(src.enabled),
    defaultTagNames: Array.isArray(src.defaultTagNames) ? src.defaultTagNames : [],
    allowAgentTagSelection: src.allowAgentTagSelection ?? true,
    topK: typeof src.topK === 'number' ? src.topK : undefined,
  };
}

function extractInput(node: WorkflowNode): Record<string, unknown> {
  if (node.type === 'join') return {};
  return (node.input ?? {}) as Record<string, unknown>;
}

/** 原地覆盖 node.input 并返回新的 WorkflowNode. 保证 discriminated union 的类型身份. */
function withInput(node: WorkflowNode, nextInput: Record<string, unknown>): WorkflowNode {
  if (node.type === 'join') return node;
  return { ...node, input: nextInput } as WorkflowNode;
}

/**
 * 当节点是 approval 且 timeout.onTimeout='goto' 时,把 on-error 边的 target
 * 同步到 `input.timeout.target`。两者共享一条 on-error 边,语义必须一致。
 */
function syncApprovalTimeoutTarget(
  node: WorkflowNode,
  draftInput: Record<string, unknown>,
  onErrorTarget: string | undefined,
): Record<string, unknown> {
  if (node.type !== 'approval') return draftInput;
  const timeout = draftInput.timeout as { duration?: string; onTimeout?: string; target?: string } | undefined;
  if (!timeout || timeout.onTimeout !== 'goto') return draftInput;
  if (!onErrorTarget || timeout.target === onErrorTarget) return draftInput;
  return { ...draftInput, timeout: { ...timeout, target: onErrorTarget } };
}

interface PropertiesPanelProps {
  data: StepNodeData;
  allStepIds: string[];
  onUpdate: (data: StepNodeData) => void;
  onDelete: () => void;
  onClose: () => void;
  /** id → label/type for every node; used by body manager */
  childNodes?: Record<string, BodyChildInfo>;
  /** id pool that can be added into a container body (typically unparented nodes) */
  availableChildIds?: string[];
  /** body/then/else 链(由 canvas 从 edges 计算后下发) */
  bodyIds?: string[];
  thenIds?: string[];
  elseIds?: string[];
  onReorderBody?: (order: { body?: string[]; then?: string[]; else?: string[] }) => void;
  /** parallel 节点分支(按 branchIndex 升序)— targetId 列表。 */
  parallelBranchIds?: string[];
  /** 重排 parallel 分支(仅 parallel 节点使用)。 */
  onReorderParallelBranches?: (order: string[]) => void;
}

const DEFAULT_ON_ERROR: NodeOnError = { action: 'fail' };

function normalizeOnError(raw: NodeOnError | undefined): NodeOnError {
  if (!raw) return { ...DEFAULT_ON_ERROR };
  return {
    action: raw.action ?? 'fail',
    ...(raw.target ? { target: raw.target } : {}),
    ...(raw.retry ? { retry: { ...raw.retry } } : {}),
  };
}

function buildOnErrorPayload(draft: NodeOnError): NodeOnError | undefined {
  const hasRetry = draft.retry && draft.retry.max > 0;
  const retry = hasRetry ? {
    max: draft.retry!.max,
    backoffMs: draft.retry!.backoffMs ?? 0,
    ...(draft.retry!.jitter ? { jitter: true } : {}),
    ...(draft.retry!.retryOn && draft.retry!.retryOn.length > 0 ? { retryOn: draft.retry!.retryOn } : {}),
  } : undefined;
  const isDefault = draft.action === 'fail' && !retry;
  if (isDefault) return undefined;
  return {
    action: draft.action,
    ...(draft.action === 'goto' && draft.target ? { target: draft.target } : {}),
    ...(retry ? { retry } : {}),
  };
}

export function PropertiesPanel({
  data, allStepIds, onUpdate, onDelete, onClose,
  childNodes, availableChildIds,
  bodyIds = [], thenIds = [], elseIds = [],
  onReorderBody,
  parallelBranchIds = [],
  onReorderParallelBranches,
}: PropertiesPanelProps) {
  const defaultTimeoutMin = 10;
  const [input, setInput] = useState<Record<string, unknown>>(() => extractInput(data.node));
  const [stepId, setStepId] = useState(data.stepId);
  const [timeoutMin, setTimeoutMin] = useState(
    data.node.policy?.timeoutMs ? data.node.policy.timeoutMs / 60_000 : defaultTimeoutMin,
  );
  const [onError, setOnError] = useState<NodeOnError>(() => normalizeOnError(data.node.onError));
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);

  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setInput(extractInput(data.node));
    setStepId(data.stepId);
    setTimeoutMin(data.node.policy?.timeoutMs ? data.node.policy.timeoutMs / 60_000 : defaultTimeoutMin);
    setOnError(normalizeOnError(data.node.onError));
  }

  useEffect(() => {
    fetch('/api/workflow/agent-presets')
      .then(r => r.json())
      .then((d: { presets?: AgentPreset[] }) => setPresets(d.presets ?? []))
      .catch(() => {});
    fetch('/api/teams')
      .then(r => r.json())
      .then((d: { teams?: Array<{ id: string; name: string }> }) => setTeams(d.teams ?? []))
      .catch(() => {});
  }, []);

  const save = useCallback(() => {
    const timeoutMs = timeoutMin > 0 ? Math.round(timeoutMin * 60_000) : undefined;
    const policy = timeoutMs
      ? { ...(data.node.policy ?? {}), timeoutMs }
      : data.node.policy;
    const onErrorPayload = buildOnErrorPayload(onError);
    const finalInput = syncApprovalTimeoutTarget(data.node, input, onErrorPayload?.target);
    const base = withInput(data.node, finalInput);
    const nextNode = {
      ...base,
      id: stepId,
      ...(policy ? { policy } : {}),
    } as WorkflowNode;
    if (onErrorPayload) nextNode.onError = onErrorPayload;
    else delete (nextNode as { onError?: unknown }).onError;
    onUpdate({ ...data, stepId, node: nextNode });
  }, [data, stepId, input, timeoutMin, onError, onUpdate]);

  const updateOnError = useCallback((patch: Partial<NodeOnError>) => {
    setOnError(prev => ({ ...prev, ...patch }));
  }, []);

  const updateRetry = useCallback((patch: Partial<NonNullable<NodeOnError['retry']>> | null) => {
    setOnError(prev => {
      if (patch === null) {
        const { retry: _discard, ...rest } = prev;
        void _discard;
        return rest;
      }
      const currRetry = prev.retry ?? { max: 1, backoffMs: 0 };
      return { ...prev, retry: { ...currRetry, ...patch } };
    });
  }, []);

  const updateInput = useCallback((key: string, value: unknown) => {
    setInput(prev => {
      if (value === undefined) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const currentPreset = typeof input.preset === 'string' ? input.preset : '';
  const showBodyManager = useMemo(
    () => onReorderBody && childNodes && (
      data.stepType === 'if-else' || data.stepType === 'for-each' || data.stepType === 'while'
    ),
    [onReorderBody, childNodes, data.stepType],
  );
  void allStepIds;

  return (
    <div className="w-56 shrink-0 border-l border-border/40 bg-muted/20 p-3 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">属性</span>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">x</button>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px]">ID</Label>
        <Input value={stepId} onChange={e => setStepId(e.target.value)} className="h-7 text-xs font-mono" />
      </div>

      {data.stepType === 'agent' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">Agent</Label>
            <Select value={currentPreset || '__none__'} onValueChange={v => updateInput('preset', v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="选择 Agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未选择</SelectItem>
                {presets.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Prompt</Label>
            <Textarea
              value={typeof input.prompt === 'string' ? input.prompt : ''}
              onChange={e => updateInput('prompt', e.target.value)}
              className="min-h-[50px] text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">验收说明（可选）</Label>
            <Textarea
              value={typeof input.expectedOutput === 'string' ? input.expectedOutput : ''}
              onChange={e => updateInput('expectedOutput', e.target.value || undefined)}
              className="min-h-[50px] text-xs"
              placeholder={'怎样算这一步做完了？留空=跳过判分'}
            />
            <p className="text-[9px] text-muted-foreground leading-tight">
              判分老师只读这段文字对照 agent 输出
            </p>
          </div>
          <CodeModeEditor
            compact
            enabled={Boolean((input.code as { script?: string } | undefined)?.script)}
            script={((input.code as { script?: string } | undefined)?.script) ?? ''}
            strategy={((input.code as { strategy?: string } | undefined)?.strategy) ?? 'code-first'}
            prompt={typeof input.prompt === 'string' ? input.prompt : ''}
            stepId={data.stepId}
            onEnabledChange={v => {
              if (v) updateInput('code', { script: '', strategy: 'code-first' });
              else updateInput('code', undefined);
            }}
            onScriptChange={v => updateInput('code', { ...(input.code as Record<string, unknown> ?? {}), script: v })}
            onStrategyChange={v => updateInput('code', { ...(input.code as Record<string, unknown> ?? {}), strategy: v })}
          />

          <WorkflowKnowledgePanel
            value={readKnowledge(input.knowledge)}
            onChange={next => updateInput('knowledge', next.enabled ? {
              enabled: true,
              defaultTagNames: next.defaultTagNames,
              allowAgentTagSelection: next.allowAgentTagSelection,
              ...(typeof next.topK === 'number' ? { topK: next.topK } : {}),
            } : undefined)}
          />
        </>
      )}

      {data.stepType === 'team' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">团队</Label>
            <Select
              value={typeof input.teamId === 'string' && input.teamId ? input.teamId : '__none__'}
              onValueChange={v => updateInput('teamId', v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="选择团队" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未选择</SelectItem>
                {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[9px] text-muted-foreground leading-tight">队长按团队 SOP 派单成员完成这一步</p>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">任务</Label>
            <Textarea
              value={typeof input.task === 'string' ? input.task : ''}
              onChange={e => updateInput('task', e.target.value)}
              className="min-h-[70px] text-xs"
              placeholder={'交给团队的任务,要自包含。支持 {{ steps.x.output.y }} 插值'}
            />
          </div>
        </>
      )}

      {data.stepType === 'if-else' && (
        <div className="space-y-1">
          <Label className="text-[10px]">条件 (JSON)</Label>
          <Textarea
            value={input.condition ? JSON.stringify(input.condition, null, 2) : ''}
            onChange={e => { try { updateInput('condition', JSON.parse(e.target.value)); } catch { /* typing */ } }}
            className="min-h-[40px] text-xs font-mono"
          />
        </div>
      )}

      {data.stepType === 'for-each' && (
        <div className="space-y-1">
          <Label className="text-[10px]">集合引用</Label>
          <Input
            value={typeof input.collection === 'string' ? input.collection : ''}
            onChange={e => updateInput('collection', e.target.value)}
            className="h-7 text-xs font-mono"
          />
        </div>
      )}

      {showBodyManager && childNodes && onReorderBody && (
        <BodyManager
          stepType={data.stepType as 'if-else' | 'for-each' | 'while'}
          body={bodyIds}
          thenIds={thenIds}
          elseIds={elseIds}
          childNodes={childNodes}
          availableIds={availableChildIds ?? []}
          onReorder={onReorderBody}
        />
      )}

      {data.stepType === 'wait' && (
        <div className="space-y-1">
          <Label className="text-[10px]">等待时长（毫秒）</Label>
          <Input
            type="number"
            value={typeof input.durationMs === 'number' ? input.durationMs : 5000}
            onChange={e => updateInput('durationMs', Number(e.target.value))}
            className="h-7 text-xs"
            min={0}
            max={3600000}
          />
        </div>
      )}

      {data.stepType === 'parallel' && (
        <div className="space-y-1">
          <Label className="text-[10px]">分支失败策略</Label>
          <Select
            value={typeof input.onBranchFail === 'string' ? input.onBranchFail : 'wait-all'}
            onValueChange={v => updateInput('onBranchFail', v)}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wait-all">全部等待（默认）</SelectItem>
              <SelectItem value="fail-fast">快速失败</SelectItem>
              <SelectItem value="best-effort">尽力而为</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] text-muted-foreground leading-tight">
            全部等待：等每条分支跑完再汇合；快速失败：有一条失败立刻中断其余分支。
          </p>
        </div>
      )}

      {data.stepType === 'parallel' && onReorderParallelBranches && childNodes && (
        <ParallelBranchManager
          branchIds={parallelBranchIds}
          childNodes={childNodes}
          onReorder={onReorderParallelBranches}
        />
      )}

      {data.stepType === 'join' && (
        <div className="space-y-1 rounded border border-border/40 bg-muted/20 p-2">
          <span className="text-[10px] font-semibold">JOIN</span>
          <p className="text-[9px] text-muted-foreground leading-tight">
            汇合所有入边分支 · 当前入边 {typeof data.inbound === 'number' ? data.inbound : '--'} 条。
            JOIN 节点本身无可配置参数,分支顺序由上游 parallel 决定。
          </p>
        </div>
      )}

      {data.stepType === 'approval' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">审批说明</Label>
            <Textarea
              value={typeof input.prompt === 'string' ? input.prompt : ''}
              onChange={e => updateInput('prompt', e.target.value)}
              className="min-h-[50px] text-xs"
              placeholder="审批人会看到这段文字"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">审批模式</Label>
            <Select
              value={(input.approvers as { mode?: string } | undefined)?.mode ?? 'any'}
              onValueChange={v => updateInput('approvers', {
                ...(input.approvers as Record<string, unknown> | undefined ?? {}),
                mode: v,
              })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">任一人批准即通过</SelectItem>
                <SelectItem value="all">需全部批准</SelectItem>
                <SelectItem value="quorum">法定人数</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">审批人（逗号分隔的用户 ID）</Label>
            <Input
              value={((input.approvers as { users?: string[] } | undefined)?.users ?? []).join(', ')}
              onChange={e => updateInput('approvers', {
                ...(input.approvers as Record<string, unknown> | undefined ?? {}),
                users: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              className="h-7 text-xs font-mono"
              placeholder="alice, bob"
            />
          </div>
          {(input.approvers as { mode?: string } | undefined)?.mode === 'quorum' && (
            <div className="space-y-1">
              <Label className="text-[10px]">法定人数</Label>
              <Input
                type="number"
                value={(input.approvers as { quorum?: number } | undefined)?.quorum ?? 2}
                onChange={e => updateInput('approvers', {
                  ...(input.approvers as Record<string, unknown> | undefined ?? {}),
                  quorum: Number(e.target.value),
                })}
                className="h-7 text-xs"
                min={1}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[10px]">超时（ISO 8601, 例如 PT1H / P1D）</Label>
            <Input
              value={(input.timeout as { duration?: string } | undefined)?.duration ?? ''}
              onChange={e => {
                const duration = e.target.value.trim();
                if (!duration) {
                  updateInput('timeout', undefined);
                  return;
                }
                const onTimeout = (input.timeout as { onTimeout?: string } | undefined)?.onTimeout ?? 'reject';
                updateInput('timeout', { duration, onTimeout });
              }}
              className="h-7 text-xs font-mono"
              placeholder="留空 = 不超时"
            />
          </div>
          {(input.timeout as { duration?: string } | undefined)?.duration && (
            <div className="space-y-1">
              <Label className="text-[10px]">超时行为</Label>
              <Select
                value={(input.timeout as { onTimeout?: string } | undefined)?.onTimeout ?? 'reject'}
                onValueChange={v => updateInput('timeout', {
                  ...(input.timeout as Record<string, unknown> | undefined ?? {}),
                  onTimeout: v,
                })}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reject">视为拒绝</SelectItem>
                  <SelectItem value="approve">视为同意</SelectItem>
                  <SelectItem value="goto">跳到指定节点</SelectItem>
                </SelectContent>
              </Select>
              {(input.timeout as { onTimeout?: string } | undefined)?.onTimeout === 'goto' && (
                <p className="text-[9px] text-muted-foreground leading-tight">
                  跳转目标在下方「错误处理」里设置为 goto + target；保存时自动共用同一条 on-error 边。
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="space-y-1">
        <Label className="text-[10px]">超时（分钟）</Label>
        <Input
          type="number"
          value={timeoutMin}
          onChange={e => setTimeoutMin(Number(e.target.value))}
          className="h-7 text-xs"
          min={1}
          max={120}
          step={1}
        />
        <p className="text-[9px] text-muted-foreground">节点执行超时时间，默认 10 分钟</p>
      </div>

      <details className="rounded border border-border/40 bg-muted/10 open:bg-muted/20">
        <summary className="cursor-pointer text-[10px] font-semibold px-2 py-1 hover:text-foreground">
          错误处理{onError.action !== 'fail' || onError.retry ? ' ·' : ''}
          {onError.action !== 'fail' ? ` ${onError.action}` : ''}
          {onError.retry ? ` retry×${onError.retry.max}` : ''}
        </summary>
        <div className="p-2 space-y-2">
          <div className="space-y-1">
            <Label className="text-[10px]">失败动作</Label>
            <Select
              value={onError.action}
              onValueChange={v => updateOnError({ action: v as NodeOnError['action'] })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fail">中断工作流（默认）</SelectItem>
                <SelectItem value="continue">忽略错误继续</SelectItem>
                <SelectItem value="goto">跳到指定节点</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {onError.action === 'goto' && (
            <div className="space-y-1">
              <Label className="text-[10px]">目标节点</Label>
              <Select
                value={onError.target ?? '__none__'}
                onValueChange={v => updateOnError({ target: v === '__none__' ? undefined : v })}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="选择节点" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未选择</SelectItem>
                  {allStepIds.filter(id => id !== stepId).map(id => (
                    <SelectItem key={id} value={id}>
                      {(childNodes?.[id]?.label ?? id)} · {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[9px] text-muted-foreground leading-tight">
                保存时自动维护一条 on-error 边指向该节点。
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[10px]">重试次数（0 = 不重试）</Label>
            <Input
              type="number"
              value={onError.retry?.max ?? 0}
              onChange={e => {
                const max = Math.max(0, Number(e.target.value) || 0);
                if (max === 0) updateRetry(null);
                else updateRetry({ max });
              }}
              className="h-7 text-xs"
              min={0}
              max={10}
            />
          </div>

          {onError.retry && (
            <>
              <div className="space-y-1">
                <Label className="text-[10px]">退避 (ms)</Label>
                <Input
                  type="number"
                  value={onError.retry.backoffMs ?? 0}
                  onChange={e => updateRetry({ backoffMs: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-7 text-xs"
                  min={0}
                  max={600000}
                  step={100}
                />
              </div>
              <label className="flex items-center gap-2 text-[10px]">
                <input
                  type="checkbox"
                  checked={Boolean(onError.retry.jitter)}
                  onChange={e => updateRetry({ jitter: e.target.checked })}
                />
                启用抖动（jitter）
              </label>
              <div className="space-y-1">
                <Label className="text-[10px]">仅重试错误码（逗号分隔，留空=全部）</Label>
                <Input
                  value={(onError.retry.retryOn ?? []).join(', ')}
                  onChange={e => {
                    const codes = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                    updateRetry({ retryOn: codes.length > 0 ? codes : undefined });
                  }}
                  className="h-7 text-xs font-mono"
                  placeholder="ETIMEDOUT, ECONNRESET"
                />
              </div>
            </>
          )}
        </div>
      </details>

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={save}>保存</Button>
        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>删除</Button>
      </div>
    </div>
  );
}
