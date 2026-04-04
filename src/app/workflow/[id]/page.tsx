'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkflowEditorView } from '@/components/workflow/WorkflowEditorView';
import { WorkflowChatPanel } from '@/components/workflow/WorkflowChatPanel';
import { BottomChatPanel } from '@/components/layout/BottomChatPanel';
import { ScheduleEditor } from '@/components/workflow/ScheduleEditor';

interface WorkflowStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
}

interface WorkflowDsl {
  version: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface WorkflowEditorDebugEntry {
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
}

function fingerprintText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return `${value.length}:${hash.toString(16)}`;
}

function logWorkflowEditorDebug(event: string, payload: Record<string, unknown>) {
  const entry: WorkflowEditorDebugEntry = {
    timestamp: new Date().toISOString(),
    event,
    payload,
  };

  if (typeof window !== 'undefined') {
    const globalWindow = window as typeof window & {
      __lumosWorkflowEditorDebug?: WorkflowEditorDebugEntry[];
    };
    const bucket = globalWindow.__lumosWorkflowEditorDebug ?? [];
    bucket.push(entry);
    if (bucket.length > 200) {
      bucket.splice(0, bucket.length - 200);
    }
    globalWindow.__lumosWorkflowEditorDebug = bucket;
  }

  console.info('[workflow-editor-debug]', entry);
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [dsl, setDsl] = useState<WorkflowDsl | null>(null);
  const [dslText, setDslText] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [presetNames, setPresetNames] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [taskRunMode, setTaskRunMode] = useState<'scheduled' | 'once'>('once');
  const [isDirty, setIsDirty] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const savedNameRef = useRef('');
  const savedDslTextRef = useRef('');
  const isDirtyRef = useRef(false);
  const currentNameRef = useRef('');
  const currentDslTextRef = useRef('');
  const computeDirty = useCallback((nextName: string, nextDslText: string) => (
    nextName !== savedNameRef.current || nextDslText !== savedDslTextRef.current
  ), []);

  const applyDirtyState = useCallback((
    source: string,
    nextDirty: boolean,
    input?: {
      nextName?: string;
      nextDslText?: string;
      extra?: Record<string, unknown>;
    },
  ) => {
    const nextName = input?.nextName ?? currentNameRef.current;
    const nextDslText = input?.nextDslText ?? currentDslTextRef.current;
    isDirtyRef.current = nextDirty;
    setIsDirty(nextDirty);
    logWorkflowEditorDebug(source, {
      nextDirty,
      currentName: nextName,
      savedName: savedNameRef.current,
      currentDslFingerprint: fingerprintText(nextDslText),
      savedDslFingerprint: fingerprintText(savedDslTextRef.current),
      ...(input?.extra ?? {}),
    });
  }, []);

  useEffect(() => {
    currentNameRef.current = name;
  }, [name]);

  useEffect(() => {
    currentDslTextRef.current = dslText;
  }, [dslText]);

  // Keep ref in sync for beforeunload handler
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Warn on browser close/refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      logWorkflowEditorDebug('beforeunload-blocked', {
        isDirty,
        isDirtyRef: isDirtyRef.current,
      });
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Load workflow
  useEffect(() => {
    fetch(`/api/workflow/definitions/${id}`)
      .then(r => r.json())
      .then((data: { workflow?: { workflowDsl: WorkflowDsl; name: string }; error?: string }) => {
        if (data.error || !data.workflow) { setLoadError(data.error ?? '工作流不存在'); return; }
        const text = JSON.stringify(data.workflow.workflowDsl, null, 2);
        setDsl(data.workflow.workflowDsl);
        setDslText(text);
        setName(data.workflow.name);
        savedDslTextRef.current = text;
        savedNameRef.current = data.workflow.name;
        applyDirtyState('load-workflow', false, {
          nextName: data.workflow.name,
          nextDslText: text,
          extra: {
            stepCount: data.workflow.workflowDsl.steps?.length ?? 0,
          },
        });
      })
      .catch(() => setLoadError('加载失败'));
  }, [applyDirtyState, id]);

  // Load preset names
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

  const handleSave = useCallback(async () => {
    if (!dsl) return;
    setSaving(true);
    setSaveMsg('');
    logWorkflowEditorDebug('save-start', {
      workflowId: id,
      stepCount: dsl.steps?.length ?? 0,
      isDirty,
      isDirtyRef: isDirtyRef.current,
      currentDslFingerprint: fingerprintText(JSON.stringify(dsl, null, 2)),
    });
    try {
      const res = await fetch(`/api/workflow/definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workflowDsl: dsl }),
      });
      const data = await res.json() as { error?: string; workflow?: { workflowDsl: WorkflowDsl; name: string } };
      if (!res.ok || data.error) { setSaveMsg(data.error || '保存失败'); return; }
      const saveValidation = (data as { validation?: ValidationResult | null }).validation ?? null;
      const persistedDsl = data.workflow?.workflowDsl ?? dsl;
      const persistedName = data.workflow?.name ?? name;
      const persistedText = JSON.stringify(persistedDsl, null, 2);
      setDsl(persistedDsl);
      setDslText(persistedText);
      setName(persistedName);
      setValidation(saveValidation);
      savedDslTextRef.current = persistedText;
      savedNameRef.current = persistedName;
      applyDirtyState('save-success', false, {
        nextName: persistedName,
        nextDslText: persistedText,
        extra: {
          workflowId: id,
          stepCount: persistedDsl.steps?.length ?? 0,
          validationValid: saveValidation?.valid ?? true,
        },
      });
      setSaveMsg(saveValidation && !saveValidation.valid ? '已保存（草稿含校验问题）' : '已保存');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      logWorkflowEditorDebug('save-failed', {
        workflowId: id,
      });
      setSaveMsg('保存失败');
    }
    finally { setSaving(false); }
  }, [applyDirtyState, dsl, id, isDirty, name]);

  const handleValidate = useCallback(async () => {
    if (!dslText) return;
    let parsed: unknown;
    try { parsed = JSON.parse(dslText); } catch { setValidation({ valid: false, errors: ['JSON 格式有误'] }); return; }
    const res = await fetch('/api/workflow/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: parsed }) });
    const data = await res.json();
    setValidation({ valid: data.validation?.valid ?? false, errors: data.validation?.errors ?? [] });
  }, [dslText]);

  const handleDslChange = useCallback((newDsl: WorkflowDsl, text: string) => {
    setDsl(newDsl);
    setDslText(text);
    setValidation(null);
    applyDirtyState('dsl-change', computeDirty(name, text), {
      nextName: name,
      nextDslText: text,
      extra: {
        stepCount: newDsl.steps?.length ?? 0,
      },
    });
  }, [applyDirtyState, computeDirty, name]);

  const handleDslTextEdit = useCallback((text: string) => {
    setDslText(text);
    try {
      const parsed = JSON.parse(text) as WorkflowDsl;
      setDsl(parsed);
      if (typeof parsed.name === 'string') {
        setName(parsed.name);
      }
      setValidation(null);
      applyDirtyState('dsl-text-edit', computeDirty(typeof parsed.name === 'string' ? parsed.name : name, text), {
        nextName: typeof parsed.name === 'string' ? parsed.name : name,
        nextDslText: text,
        extra: {
          parseSucceeded: true,
          stepCount: parsed.steps?.length ?? 0,
        },
      });
    } catch {
      applyDirtyState('dsl-text-edit', computeDirty(name, text), {
        nextName: name,
        nextDslText: text,
        extra: {
          parseSucceeded: false,
        },
      });
    }
  }, [applyDirtyState, computeDirty, name]);

  const handleNameBlur = useCallback(() => {
    setEditingName(false);
    if (!dsl || name === dsl.name) {
      return;
    }
    const nextDsl = { ...dsl, name };
    const nextText = JSON.stringify(nextDsl, null, 2);
    setDsl(nextDsl);
    setDslText(nextText);
    applyDirtyState('name-blur', computeDirty(name, nextText), {
      nextName: name,
      nextDslText: nextText,
    });
  }, [applyDirtyState, computeDirty, dsl, name]);

  const handleApplyDsl = useCallback((raw: Record<string, unknown>) => {
    const next = raw as unknown as WorkflowDsl;
    if (!next.steps || !Array.isArray(next.steps)) return;
    const nextText = JSON.stringify(next, null, 2);
    const nextName = next.name || name;
    setDsl(next);
    setDslText(nextText);
    if (next.name) setName(next.name);
    applyDirtyState('apply-dsl', computeDirty(nextName, nextText), {
      nextName,
      nextDslText: nextText,
      extra: {
        stepCount: next.steps?.length ?? 0,
      },
    });
  }, [applyDirtyState, computeDirty, name]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" onClick={() => router.push('/workflow')}>返回工作流列表</Button>
      </div>
    );
  }

  if (!dsl) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="space-y-2 animate-pulse w-64">
          <div className="h-4 bg-muted/40 rounded" />
          <div className="h-4 bg-muted/30 rounded w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Minimal header */}
      <div className="flex items-center gap-3 border-b border-border/50 px-6 py-3 shrink-0">
        <Button
          variant="ghost" size="sm"
          className="text-muted-foreground h-7 px-2 text-xs"
          onClick={() => {
            logWorkflowEditorDebug('leave-click', {
              isDirty,
              isDirtyRef: isDirtyRef.current,
              currentName: name,
              savedName: savedNameRef.current,
              currentDslFingerprint: fingerprintText(dslText),
              savedDslFingerprint: fingerprintText(savedDslTextRef.current),
            });
            if (isDirty && !window.confirm('有未保存的更改，确认离开？未保存内容将丢失。')) return;
            router.push('/workflow');
          }}
        >
          ← 工作流
        </Button>
        <span className="text-border/50 text-sm">|</span>

        {editingName ? (
          <Input
            ref={nameInputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') nameInputRef.current?.blur(); }}
            className="h-7 text-sm font-medium w-56 px-2"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="text-sm font-medium hover:text-foreground text-foreground/80 transition-colors truncate max-w-xs"
            title="点击编辑名称"
          >
            {name}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isDirty && !saving && !saveMsg && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              未保存
            </span>
          )}
          {saveMsg && (
            <span className={`text-xs ${saveMsg.includes('失败') ? 'text-destructive' : 'text-muted-foreground'}`}>
              {saveMsg}
            </span>
          )}
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => { setTaskRunMode('once'); setTaskEditorOpen(true); }}
          >
            运行
          </Button>
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => { setTaskRunMode('scheduled'); setTaskEditorOpen(true); }}
          >
            定时任务
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* Full-height editor */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <WorkflowEditorView
          dsl={dsl}
          dslText={dslText}
          validation={validation}
          presetNames={presetNames}
          savedWorkflowId={id}
          saving={saving}
          saveMsg={saveMsg}
          onDslChange={handleDslChange}
          onDslTextEdit={handleDslTextEdit}
          onValidate={handleValidate}
          onSave={handleSave}
          hideToolbar
          canvasHeight={640}
        />
      </div>

      {/* Task creation dialog */}
      <ScheduleEditor
        open={taskEditorOpen}
        presetWorkflowId={id}
        presetRunMode={taskRunMode}
        onClose={() => setTaskEditorOpen(false)}
        onSave={() => setTaskEditorOpen(false)}
      />

      {/* Bottom AI chat — same component as library */}
      <BottomChatPanel>
        {({ collapsed, expand }) => (
          <WorkflowChatPanel
            workflowId={id}
            currentDsl={dsl as unknown as Record<string, unknown>}
            onApplyDsl={handleApplyDsl}
            compactInputOnly={collapsed}
            onInputFocus={expand}
            fullWidth
            hideEmptyState
          />
        )}
      </BottomChatPanel>
    </div>
  );
}
