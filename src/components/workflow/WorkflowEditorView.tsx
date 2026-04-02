'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { WorkflowDslGraph } from './WorkflowDslGraph';
import { WorkflowDslViewer } from './WorkflowDslViewer';
import { WorkflowResultToolbar } from './WorkflowResultToolbar';
import { WorkflowStepEditor } from './WorkflowStepEditor';
import { WorkflowParamManager } from './WorkflowParamManager';
import type { WorkflowParamDef } from '@/lib/workflow/types';

const WorkflowCanvas = dynamic(
  () => import('./visual-editor/workflow-canvas').then(m => ({ default: m.WorkflowCanvas })),
  { ssr: false, loading: () => <div className="h-[480px] rounded-xl border border-border/40 animate-pulse bg-muted/20" /> },
);

interface WorkflowStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  policy?: { timeoutMs?: number; retry?: { maximumAttempts?: number } };
}

interface WorkflowDslResult {
  version: string;
  name: string;
  description?: string;
  params?: WorkflowParamDef[];
  steps: WorkflowStep[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type ViewMode = 'graph' | 'visual' | 'json';

interface WorkflowEditorViewProps {
  dsl: WorkflowDslResult;
  dslText: string;
  validation: ValidationResult | null;
  presetNames: Record<string, string>;
  savedWorkflowId: string | null;
  saving: boolean;
  saveMsg: string;
  onDslChange: (dsl: WorkflowDslResult, text: string) => void;
  onDslTextEdit: (text: string) => void;
  onValidate: () => void;
  onSave: () => void;
  onSaveAsTemplate?: () => void;
  onSaveToSchedule?: () => void;
  hideToolbar?: boolean;
  canvasHeight?: number;
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

  const unusedParams = (() => {
    const params = dsl.params ?? [];
    if (params.length === 0) return [];
    const allPrompts = dsl.steps
      .map(s => (typeof s.input?.prompt === 'string' ? s.input.prompt : ''))
      .join('\n');
    return params.filter(p => !allPrompts.includes(`{{input.${p.name}`));
  })();

  const handleStepSave = useCallback((updated: WorkflowStep) => {
    const newSteps = dsl.steps.map(s => s.id === selectedStepId ? updated : s);
    const newDsl = { ...dsl, steps: newSteps };
    onDslChange(newDsl, JSON.stringify(newDsl, null, 2));
    setSelectedStepId(null);
  }, [dsl, selectedStepId, onDslChange]);

  const handleStepDelete = useCallback((stepId: string) => {
    const newSteps = dsl.steps
      .filter(s => s.id !== stepId)
      .map(s => ({ ...s, dependsOn: s.dependsOn?.filter(d => d !== stepId) }));
    const newDsl = { ...dsl, steps: newSteps };
    onDslChange(newDsl, JSON.stringify(newDsl, null, 2));
    setSelectedStepId(null);
  }, [dsl, onDslChange]);

  const handleVisualChange = useCallback((newDsl: WorkflowDslResult) => {
    onDslChange(newDsl, JSON.stringify(newDsl, null, 2));
  }, [onDslChange]);

  return (
    <div className="space-y-2">
      {!hideToolbar && (
        <WorkflowResultToolbar
          name={dsl.name}
          stepCount={dsl.steps.length}
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

      {/* Editor content — no Card wrapper, full width */}
      {viewMode === 'graph' && (
        <WorkflowDslGraph
          steps={dsl.steps}
          presetNames={presetNames}
          selectedStepId={selectedStepId}
          onStepClick={setSelectedStepId}
        />
      )}
      {viewMode === 'visual' && (
        <WorkflowCanvas dsl={dsl} presetNames={presetNames} onChange={handleVisualChange} height={canvasHeight} />
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

      {viewMode === 'graph' && selectedStepId && dsl.steps.find(s => s.id === selectedStepId) && (
        <WorkflowStepEditor
          key={selectedStepId}
          step={dsl.steps.find(s => s.id === selectedStepId)!}
          allStepIds={dsl.steps.map(s => s.id)}
          workflowParams={dsl.params ?? []}
          onSave={handleStepSave}
          onCancel={() => setSelectedStepId(null)}
          onDelete={handleStepDelete}
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
              const newDsl = { ...dsl, params: params.length > 0 ? params : undefined };
              onDslChange(newDsl, JSON.stringify(newDsl, null, 2));
            }}
          />
        </div>
      )}
    </div>
  );
}
