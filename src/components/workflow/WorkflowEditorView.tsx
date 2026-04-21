'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { WorkflowDslGraph } from './WorkflowDslGraph';
import { WorkflowDslViewer } from './WorkflowDslViewer';
import { WorkflowResultToolbar } from './WorkflowResultToolbar';
import { WorkflowStepEditor } from './WorkflowStepEditor';
import { WorkflowParamManager } from './WorkflowParamManager';
import { DebugRunHistory } from './DebugRunHistory';
import { removeNodeFromDsl } from '@/lib/workflow/dsl-graph-converter';
import type { WorkflowDSLV3, WorkflowNode } from '@/lib/workflow/types-v3';
import { useWorkflowDebugStore } from '@/stores/workflow-debug-store';

const WorkflowCanvas = dynamic(
  () => import('./visual-editor/workflow-canvas').then(m => ({ default: m.WorkflowCanvas })),
  { ssr: false, loading: () => <div className="h-[480px] rounded-xl border border-border/40 animate-pulse bg-muted/20" /> },
);

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type ViewMode = 'graph' | 'visual' | 'json';

interface WorkflowEditorViewProps {
  dsl: WorkflowDSLV3;
  dslText: string;
  validation: ValidationResult | null;
  presetNames: Record<string, string>;
  savedWorkflowId: string | null;
  saving: boolean;
  saveMsg: string;
  onDslChange: (dsl: WorkflowDSLV3, text: string) => void;
  onDslTextEdit: (text: string) => void;
  onValidate: () => void;
  onSave: () => void;
  onSaveAsTemplate?: () => void;
  onSaveToSchedule?: () => void;
  hideToolbar?: boolean;
  canvasHeight?: number;
}

function readAgentPrompt(node: WorkflowNode): string {
  if (node.type !== 'agent') return '';
  const input = node.input as Record<string, unknown>;
  return typeof input.prompt === 'string' ? input.prompt : '';
}

export function WorkflowEditorView({
  dsl, dslText, validation, presetNames,
  savedWorkflowId, saving, saveMsg,
  onDslChange, onDslTextEdit, onValidate, onSave,
  onSaveAsTemplate, onSaveToSchedule,
  hideToolbar = false,
  canvasHeight = 480,
}: WorkflowEditorViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [dslEditMode, setDslEditMode] = useState(false);

  const debugEnabled = useWorkflowDebugStore(s => s.enabled);
  const debugRunning = useWorkflowDebugStore(s => s.running);
  const debugError = useWorkflowDebugStore(s => s.error);
  const debugSnapshot = useWorkflowDebugStore(s => s.snapshot);
  const toggleDebug = useWorkflowDebugStore(s => s.setEnabled);
  const clearAllDebug = useWorkflowDebugStore(s => s.clearAllCache);
  const cachedCount = debugSnapshot ? Object.keys(debugSnapshot.cachedSteps).length : 0;

  const unusedParams = (() => {
    const params = dsl.params ?? [];
    if (params.length === 0) return [];
    const allPrompts = dsl.nodes.map(readAgentPrompt).join('\n');
    return params.filter(p => !allPrompts.includes(`{{input.${p.name}`));
  })();

  const handleNodeSave = useCallback((updated: WorkflowNode) => {
    const newNodes = dsl.nodes.map(n => n.id === selectedStepId ? updated : n);
    const nextDsl: WorkflowDSLV3 = { ...dsl, nodes: newNodes };
    onDslChange(nextDsl, JSON.stringify(nextDsl, null, 2));
    setSelectedStepId(null);
  }, [dsl, selectedStepId, onDslChange]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    const nextDsl = removeNodeFromDsl(dsl, nodeId);
    onDslChange(nextDsl, JSON.stringify(nextDsl, null, 2));
    setSelectedStepId(null);
  }, [dsl, onDslChange]);

  const handleVisualChange = useCallback((newDsl: WorkflowDSLV3) => {
    onDslChange(newDsl, JSON.stringify(newDsl, null, 2));
  }, [onDslChange]);

  const selectedNode = selectedStepId ? dsl.nodes.find(n => n.id === selectedStepId) : undefined;

  return (
    <div className="space-y-2">
      {!hideToolbar && (
        <WorkflowResultToolbar
          name={dsl.name}
          stepCount={dsl.nodes.length}
          savedWorkflowId={savedWorkflowId}
          saving={saving}
          saveMsg={saveMsg}
          validForActions={validation?.valid ?? false}
          onSave={onSave}
          onSaveAsTemplate={onSaveAsTemplate}
          onSaveToSchedule={onSaveToSchedule}
        />
      )}

      {validation && (
        <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded ${
          validation.valid
            ? 'bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-destructive/10 text-destructive'
        }`}>
          {validation.valid ? 'DSL 有效' : validation.errors[0] || '验证失败'}
        </div>
      )}

      {/* Compact tab bar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {(['graph', 'visual', 'json'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setSelectedStepId(null); }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {mode === 'graph' ? '图表' : mode === 'visual' ? '可视化编辑' : 'JSON'}
            </button>
          ))}
        </div>

        {(viewMode === 'visual' || viewMode === 'graph') && savedWorkflowId && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={() => {
                if (viewMode === 'graph') {
                  setViewMode('visual');
                  setSelectedStepId(null);
                  if (!debugEnabled) toggleDebug(true);
                } else {
                  toggleDebug(!debugEnabled);
                }
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                debugEnabled
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent border-border/50'
              }`}
              title={viewMode === 'graph'
                ? '切换到可视化编辑并开启调试模式(右键节点选择运行到此处 / 重跑 / 从此处继续)'
                : '开启后右键节点可选择运行到此处 / 重跑 / 从此处继续'}
            >
              调试模式{debugEnabled && cachedCount > 0 ? ` · ${cachedCount}` : ''}
            </button>
            {viewMode === 'visual' && debugEnabled && (
              <>
                {debugRunning && (
                  <span className="text-[10px] text-blue-600 dark:text-blue-400">运行中…</span>
                )}
                {cachedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`清空全部 ${cachedCount} 个节点缓存?`)) void clearAllDebug();
                    }}
                    className="px-2 py-0.5 rounded text-[10px] text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-red-500/30"
                  >
                    清空缓存
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {debugEnabled && debugError && (
        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-destructive/10 text-destructive">
          调试失败: {debugError}
        </div>
      )}

      {viewMode === 'visual' && debugEnabled && savedWorkflowId && (
        <DebugRunHistory workflowId={savedWorkflowId} refreshToken={debugSnapshot} />
      )}

      {/* Editor content — no Card wrapper, full width */}
      {viewMode === 'graph' && (
        <WorkflowDslGraph
          dsl={dsl}
          presetNames={presetNames}
          selectedStepId={selectedStepId}
          onStepClick={setSelectedStepId}
        />
      )}
      {viewMode === 'visual' && (
        <WorkflowCanvas
          dsl={dsl}
          presetNames={presetNames}
          onChange={handleVisualChange}
          height={canvasHeight}
          workflowId={savedWorkflowId}
        />
      )}
      {viewMode === 'json' && (
        <WorkflowDslViewer
          dslText={dslText}
          editMode={dslEditMode}
          onEdit={onDslTextEdit}
          onToggleEdit={() => setDslEditMode(v => !v)}
          onValidate={onValidate}
          minHeight={canvasHeight}
        />
      )}

      {viewMode === 'graph' && selectedNode && (
        <WorkflowStepEditor
          key={selectedNode.id}
          node={selectedNode}
          workflowParams={dsl.params ?? []}
          onSave={handleNodeSave}
          onCancel={() => setSelectedStepId(null)}
          onDelete={handleNodeDelete}
        />
      )}

      {viewMode === 'graph' && unusedParams.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          ⚠ 参数 <strong>{unusedParams.map(p => p.name).join('、')}</strong> 未在任何步骤 Prompt 中使用。
          请在步骤里加入 <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">{'{{'}input.{unusedParams[0].name}{'}}'}</code> 等引用，参数才会生效。
        </div>
      )}

      {viewMode === 'graph' && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <WorkflowParamManager
            params={dsl.params ?? []}
            onChange={params => {
              const newDsl: WorkflowDSLV3 = {
                ...dsl,
                ...(params.length > 0 ? { params } : {}),
              };
              if (params.length === 0) delete (newDsl as { params?: unknown }).params;
              onDslChange(newDsl, JSON.stringify(newDsl, null, 2));
            }}
          />
        </div>
      )}
    </div>
  );
}
