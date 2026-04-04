'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STRATEGY_LABELS: Record<string, string> = {
  'code-first': '代码优先（失败回退 Agent）',
  'code-only': '仅代码',
  'agent-only': '仅 Agent',
};

interface CodeRunResult {
  success: boolean;
  output: unknown;
  error?: string;
  stack?: string;
  logs: string[];
  durationMs: number;
}

interface CodeModeEditorProps {
  enabled: boolean;
  script: string;
  strategy: string;
  prompt: string;
  onEnabledChange: (v: boolean) => void;
  onScriptChange: (v: string) => void;
  onStrategyChange: (v: string) => void;
  /** 紧凑模式（用于 PropertiesPanel） */
  compact?: boolean;
  /** 定时任务 ID（用于获取历史执行 trace） */
  scheduleId?: string;
  /** 步骤 ID（用于获取历史执行 trace） */
  stepId?: string;
}

export function CodeModeEditor({
  enabled, script, strategy, prompt,
  onEnabledChange, onScriptChange, onStrategyChange,
  compact = false, scheduleId, stepId,
}: CodeModeEditorProps) {
  const [codifying, setCodifying] = useState(false);
  const [codifyError, setCodifyError] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<CodeRunResult | null>(null);

  async function handleCodify() {
    if (!prompt.trim()) return;
    setCodifying(true);
    setCodifyError('');
    try {
      // 先尝试获取历史执行 trace（从所有 schedule 的执行记录中搜索）
      let trace = '（尚无执行记录，请根据 prompt 生成初始代码）';
      if (stepId) {
        try {
          const sid = scheduleId || '_global';
          const traceRes = await fetch(`/api/workflow/schedules/${sid}/step-trace?stepId=${encodeURIComponent(stepId)}`);
          const traceData = await traceRes.json() as { trace?: string | null };
          if (traceData.trace) {
            trace = traceData.trace;
          }
        } catch { /* 获取 trace 失败不阻塞 */ }
      }

      const res = await fetch('/api/workflow/codify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, trace }),
      });
      const data = await res.json() as { script?: string; error?: string };
      if (data.error) { setCodifyError(data.error); return; }
      if (data.script) onScriptChange(data.script);
    } catch {
      setCodifyError('生成失败，请检查 Codify Agent 配置');
    } finally {
      setCodifying(false);
    }
  }

  const handleRun = useCallback(async () => {
    if (!script.trim()) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch('/api/workflow/code-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const data = await res.json() as CodeRunResult;
      setRunResult(data);
    } catch {
      setRunResult({ success: false, output: null, error: '请求失败', logs: [], durationMs: 0 });
    } finally {
      setRunning(false);
    }
  }, [script]);

  const labelSize = compact ? 'text-[10px]' : 'text-xs';
  const subLabelSize = compact ? 'text-[9px]' : 'text-[10px]';

  return (
    <div className="space-y-2 border-t border-border/40 pt-3">
      <div className="flex items-center justify-between">
        <Label className={labelSize}>代码模式</Label>
        <div className="flex items-center gap-1.5">
          {enabled && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 bg-emerald-500/15 text-emerald-600 border-emerald-500/20">
              已启用
            </Badge>
          )}
          <button
            type="button"
            onClick={() => onEnabledChange(!enabled)}
            className={`${subLabelSize} text-primary hover:underline`}
          >
            {enabled ? '关闭' : '启用'}
          </button>
        </div>
      </div>

      {enabled && (
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className={`${subLabelSize} text-muted-foreground`}>脚本代码</Label>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[10px] px-2"
                  disabled={running || !script.trim()}
                  onClick={() => void handleRun()}
                >
                  {running ? '运行中...' : '运行'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[10px] px-2"
                  disabled={codifying || !prompt.trim()}
                  onClick={() => void handleCodify()}
                >
                  {codifying ? '生成中...' : 'AI 生成'}
                </Button>
              </div>
            </div>
            <Textarea
              value={script}
              onChange={e => onScriptChange(e.target.value)}
              className={`${compact ? 'min-h-[80px] text-[10px]' : 'min-h-[120px] text-xs'} font-mono`}
              placeholder={`// ctx.params — 参数\n// ctx.upstreamOutputs — 上游输出\n// ctx.signal — AbortSignal\n\nreturn { success: true, output: { summary: '完成' } };`}
              spellCheck={false}
            />
            {codifyError && <p className="text-[10px] text-destructive">{codifyError}</p>}
            <p className={`${compact ? 'text-[8px]' : 'text-[9px]'} text-muted-foreground`}>
              async function body，可用 ctx，必须 return {'{'} success, output {'}'} 对象
            </p>
            {runResult && (
              <div className={`rounded border p-2 space-y-1 ${runResult.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
                <div className="flex items-center justify-between">
                  <span className={`${subLabelSize} font-medium ${runResult.success ? 'text-emerald-600' : 'text-destructive'}`}>
                    {runResult.success ? 'OK' : 'FAILED'} ({runResult.durationMs}ms)
                  </span>
                  <button type="button" onClick={() => setRunResult(null)} className={`${subLabelSize} text-muted-foreground hover:text-foreground`}>
                    关闭
                  </button>
                </div>
                {runResult.error && (
                  <pre className={`${subLabelSize} text-destructive whitespace-pre-wrap break-all`}>{runResult.error}</pre>
                )}
                {runResult.output != null && (
                  <pre className={`${subLabelSize} text-foreground/80 whitespace-pre-wrap break-all max-h-32 overflow-auto`}>
                    {typeof runResult.output === 'string' ? runResult.output : JSON.stringify(runResult.output, null, 2)}
                  </pre>
                )}
                {runResult.logs.length > 0 && (
                  <details className={subLabelSize}>
                    <summary className="text-muted-foreground cursor-pointer">console ({runResult.logs.length})</summary>
                    <pre className="mt-1 text-muted-foreground whitespace-pre-wrap break-all max-h-24 overflow-auto">
                      {runResult.logs.join('\n')}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className={`${subLabelSize} text-muted-foreground`}>执行策略</Label>
            <Select value={strategy} onValueChange={onStrategyChange}>
              <SelectTrigger className={`${compact ? 'h-6 text-[10px]' : 'h-7 text-xs'}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
