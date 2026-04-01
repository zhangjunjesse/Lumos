'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { WorkflowEditorView } from './WorkflowEditorView';
import type { WorkflowParamDef } from '@/lib/workflow/types';

interface WorkflowStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
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

const EXAMPLES = [
  { icon: '📰', title: 'AI 新闻摘要', desc: '每天搜索 AI 领域新闻，整理成摘要并通知我' },
  { icon: '📸', title: '网页截图分析', desc: '访问指定网址，截图后用 AI 分析页面内容' },
  { icon: '📊', title: '竞品价格追踪', desc: '从网页收集竞品价格信息，对比分析后生成报告' },
];

interface WorkflowBuilderPanelProps {
  onSaveToSchedule?: (dsl: WorkflowDslResult) => void;
  onSaveAsTemplate?: (dsl: WorkflowDslResult) => void;
  onSaved?: (id: string) => void;
}

export function WorkflowBuilderPanel({ onSaveToSchedule, onSaveAsTemplate, onSaved }: WorkflowBuilderPanelProps) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [dsl, setDsl] = useState<WorkflowDslResult | null>(null);
  const [dslText, setDslText] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState('');
  const [presetNames, setPresetNames] = useState<Record<string, string>>({});

  // Save/load state
  const [savedWorkflowId, setSavedWorkflowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');


  useEffect(() => {
    fetch('/api/workflow/agent-presets')
      .then(r => r.json())
      .then((data: { presets?: Array<{ id: string; name: string }> }) => {
        const map: Record<string, string> = {};
        for (const p of data.presets ?? []) map[p.id] = p.name;
        setPresetNames(map);
      })
      .catch(() => {});
  }, []);

  const generate = useCallback(async () => {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError('');
    setDsl(null);
    setValidation(null);
    setSavedWorkflowId(null);
    setSaveMsg('');
    try {
      const res = await fetch('/api/workflow/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || '生成失败，请重试'); return; }
      setDsl(data.workflowDsl);
      setDslText(JSON.stringify(data.workflowDsl, null, 2));
      setValidation(data.validation);
    } catch { setError('网络错误，请重试'); } finally { setLoading(false); }
  }, [description, loading]);

  const handleDslEdit = useCallback((text: string) => {
    setDslText(text);
    try { setDsl(JSON.parse(text) as WorkflowDslResult); setValidation(null); } catch { /* typing */ }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!dslText) return;
    let parsed: unknown;
    try { parsed = JSON.parse(dslText); } catch { setValidation({ valid: false, errors: ['JSON 格式有误'] }); return; }
    const res = await fetch('/api/workflow/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: parsed }) });
    const data = await res.json();
    setValidation({ valid: data.validation?.valid ?? false, errors: data.validation?.errors ?? [] });
  }, [dslText]);

  const handleSaveWorkflow = useCallback(async () => {
    if (!dsl) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const url = savedWorkflowId
        ? `/api/workflow/definitions/${savedWorkflowId}`
        : '/api/workflow/definitions';
      const method = savedWorkflowId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dsl.name,
          description: dsl.description || '',
          workflowDsl: dsl,
          createdBy: 'builder',
        }),
      });
      const data = await res.json() as { workflow?: { id: string }; error?: string };
      if (!res.ok || data.error) {
        setSaveMsg(data.error || '保存失败');
        return;
      }
      if (data.workflow?.id) {
        setSavedWorkflowId(data.workflow.id);
        if (!savedWorkflowId) onSaved?.(data.workflow.id);
      }
      setSaveMsg(savedWorkflowId ? '已更新' : '已保存');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg('保存失败');
    } finally {
      setSaving(false);
    }
  }, [dsl, savedWorkflowId, onSaved]);

  const handleDslChange = useCallback((newDsl: WorkflowDslResult, text: string) => {
    setDsl(newDsl);
    setDslText(text);
    setValidation(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">工作流构建器</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            用自然语言描述你的工作流，AI 将为你生成可执行的工作流 DSL
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="描述你想要自动化的工作流...&#10;例如：每天搜索最新 AI 资讯，整理成摘要，通知我"
          className="min-h-[100px] text-sm"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
        />

        {!dsl && !loading && (
          <div className="grid grid-cols-3 gap-2">
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => setDescription(ex.desc)} className="flex flex-col gap-1.5 p-3 rounded-lg border border-border/40 hover:border-border hover:bg-accent/50 transition-all text-left">
                <span className="text-lg">{ex.icon}</span>
                <span className="text-xs font-medium">{ex.title}</span>
                <span className="text-[10px] text-muted-foreground line-clamp-2">{ex.desc}</span>
              </button>))}
          </div>)}

        <div className="flex items-center justify-end">
          <Button onClick={generate} disabled={loading || !description.trim()}>
            {loading ? '生成中...' : '生成工作流'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {loading && (
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-32 rounded bg-muted/50" />
          <div className="h-16 rounded bg-muted/30" />
        </div>
      )}

      {dsl && !loading && (
        <WorkflowEditorView
          dsl={dsl}
          dslText={dslText}
          validation={validation}
          presetNames={presetNames}
          savedWorkflowId={savedWorkflowId}
          saving={saving}
          saveMsg={saveMsg}
          onDslChange={handleDslChange}
          onDslTextEdit={handleDslEdit}
          onValidate={handleValidate}
          onSave={handleSaveWorkflow}
          onSaveAsTemplate={onSaveAsTemplate ? () => onSaveAsTemplate(dsl) : undefined}
          onSaveToSchedule={onSaveToSchedule ? () => onSaveToSchedule(dsl) : undefined}
        />
      )}
    </div>
  );
}
