'use client';

import { useState } from 'react';
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
}

export function CodeModeEditor({
  enabled, script, strategy, prompt,
  onEnabledChange, onScriptChange, onStrategyChange,
  compact = false,
}: CodeModeEditorProps) {
  const [codifying, setCodifying] = useState(false);
  const [codifyError, setCodifyError] = useState('');

  async function handleCodify() {
    if (!prompt.trim()) return;
    setCodifying(true);
    setCodifyError('');
    try {
      const res = await fetch('/api/workflow/codify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          trace: '（尚无执行记录，请根据 prompt 生成初始代码）',
        }),
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
