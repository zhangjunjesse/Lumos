'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface WorkflowStep {
  id: string;
  type: string;
  dependsOn?: string[];
  when?: unknown;
  input?: Record<string, unknown>;
}

interface WorkflowDslResult {
  version: string;
  name: string;
  steps: WorkflowStep[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const STEP_TYPE_ICONS: Record<string, string> = {
  agent: '🤖',
  browser: '🌐',
  notification: '📢',
  capability: '⚙️',
};

const EXAMPLE_PROMPTS = [
  '每天早上搜索今日 AI 领域新闻，整理成摘要并通知我',
  '访问指定网址，截图后用 AI 分析页面内容，写入报告',
  '从网页收集竞品价格信息，对比分析后生成报告',
];

function StepCard({ step, index }: { step: WorkflowStep; index: number }) {
  const icon = STEP_TYPE_ICONS[step.type] || '⚡';
  const prompt = String(step.input?.prompt ?? step.input?.message ?? step.input?.url ?? '');

  return (
    <div className="flex gap-3 text-sm">
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-mono">
          {index + 1}
        </div>
        {index < 99 && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className="flex-1 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span>{icon}</span>
          <span className="font-medium">{step.id}</span>
          <Badge variant="outline" className="text-xs">{step.type}</Badge>
          {Boolean(step.when) && <Badge variant="secondary" className="text-xs">条件</Badge>}
        </div>
        {step.dependsOn && step.dependsOn.length > 0 && (
          <div className="text-xs text-muted-foreground mb-1">
            依赖: {step.dependsOn.join(', ')}
          </div>
        )}
        {prompt && (
          <div className="text-xs text-muted-foreground line-clamp-2 bg-muted/50 rounded px-2 py-1">
            {prompt}
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkflowBuilderPanelProps {
  onSaveToSchedule?: (dsl: WorkflowDslResult) => void;
  onSaveAsTemplate?: (dsl: WorkflowDslResult) => void;
}

export function WorkflowBuilderPanel({ onSaveToSchedule, onSaveAsTemplate }: WorkflowBuilderPanelProps) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [dsl, setDsl] = useState<WorkflowDslResult | null>(null);
  const [dslText, setDslText] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState('');
  const [dslEditMode, setDslEditMode] = useState(false);

  const generate = useCallback(async () => {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError('');
    setDsl(null);
    setValidation(null);

    try {
      const res = await fetch('/api/workflow/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || '生成失败，请重试');
        return;
      }

      setDsl(data.workflowDsl);
      setDslText(JSON.stringify(data.workflowDsl, null, 2));
      setValidation(data.validation);
      setDslEditMode(false);
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }, [description, loading]);

  const handleDslEdit = useCallback((text: string) => {
    setDslText(text);
    try {
      const parsed = JSON.parse(text) as WorkflowDslResult;
      setDsl(parsed);
      setValidation(null);
    } catch {
      // ignore parse error while typing
    }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!dslText) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dslText);
    } catch {
      setValidation({ valid: false, errors: ['JSON 格式有误'] });
      return;
    }
    const res = await fetch('/api/workflow/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: parsed }),
    });
    const data = await res.json();
    setValidation({ valid: data.validation?.valid ?? false, errors: data.validation?.errors ?? [] });
  }, [dslText]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold">工作流构建器</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          用自然语言描述你的工作流，AI 将为你生成可执行的工作流 DSL
        </p>
      </div>

      {/* Input */}
      <div className="space-y-2">
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="描述你想要自动化的工作流...&#10;例如：每天搜索最新 AI 资讯，整理成摘要，通知我"
          className="min-h-[100px]"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
          }}
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {EXAMPLE_PROMPTS.map((p, i) => (
              <button
                key={i}
                onClick={() => setDescription(p)}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-dashed border-border/50 hover:border-border transition-colors"
              >
                {p.slice(0, 20)}...
              </button>
            ))}
          </div>
          <Button onClick={generate} disabled={loading || !description.trim()}>
            {loading ? '生成中...' : '✨ AI 生成'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Result */}
      {dsl && (
        <div className="space-y-4">
          {/* Validation status */}
          {validation && (
            <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${validation.valid ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>
              {validation.valid ? '✅ DSL 有效，可以执行' : `❌ 验证失败: ${validation.errors[0] || '未知错误'}`}
            </div>
          )}

          {/* Step visualization */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{dsl.name}</div>
                  <div className="text-xs text-muted-foreground">{dsl.steps.length} 个步骤</div>
                </div>
                <div className="flex gap-2">
                  {onSaveAsTemplate && validation?.valid && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onSaveAsTemplate(dsl)}>
                      保存为模板
                    </Button>
                  )}
                  {onSaveToSchedule && validation?.valid && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => onSaveToSchedule(dsl)}>
                      创建定时任务
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-2">
              {dsl.steps.map((step, i) => (
                <StepCard key={step.id} step={step} index={i} />
              ))}
            </CardContent>
          </Card>

          {/* DSL Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">工作流 DSL</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setDslEditMode(v => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {dslEditMode ? '收起编辑' : '编辑 DSL'}
                </button>
                {dslEditMode && (
                  <button
                    onClick={handleValidate}
                    className="text-xs text-primary hover:underline"
                  >
                    验证
                  </button>
                )}
              </div>
            </div>
            {dslEditMode ? (
              <Textarea
                value={dslText}
                onChange={e => handleDslEdit(e.target.value)}
                className="font-mono text-xs min-h-[200px]"
              />
            ) : (
              <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto max-h-48 text-muted-foreground">
                {dslText}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
