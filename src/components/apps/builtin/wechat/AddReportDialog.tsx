'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  defaultTitle,
  routeReportTemplate,
  type CustomReportTemplate,
} from './custom-reports';

const SAMPLE_PROMPTS = [
  '看看我最常用的 emoji',
  '我半夜都在跟谁聊天',
  '我最近说过哪些需要确认的事',
  '最近 7 天哪些对话最活跃',
];

type Stage = 'idle' | 'thinking' | 'matched';

export function AddReportDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (prompt: string) => void;
}): React.ReactElement {
  const [prompt, setPrompt] = React.useState('');
  const [stage, setStage] = React.useState<Stage>('idle');
  const [matched, setMatched] = React.useState<{ template: CustomReportTemplate; title: string } | null>(null);
  const timersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const cleanup = React.useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const reset = React.useCallback(() => {
    cleanup();
    setPrompt('');
    setStage('idle');
    setMatched(null);
  }, [cleanup]);

  React.useEffect(() => () => cleanup(), [cleanup]);

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || stage !== 'idle') return;
    const template = routeReportTemplate(trimmed);
    setMatched({ template, title: defaultTitle(template) });
    setStage('thinking');
    timersRef.current.push(
      setTimeout(() => setStage('matched'), 800),
    );
    timersRef.current.push(
      setTimeout(() => {
        onSubmit(trimmed);
        reset();
        onOpenChange(false);
      }, 1500),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && stage !== 'idle') return; // 思考中禁止关闭
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium tracking-tight">
            <Sparkles className="size-4" />
            加一个自定义统计报表
          </DialogTitle>
        </DialogHeader>

        {stage === 'idle' ? (
          <IdleForm
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={submit}
            onPickSample={setPrompt}
          />
        ) : (
          <ThinkingPanel stage={stage} matched={matched} prompt={prompt} />
        )}

        {stage === 'idle' ? (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={submit} disabled={!prompt.trim()}>
              生成
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function IdleForm({
  prompt,
  onPromptChange,
  onSubmit,
  onPickSample,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onPickSample: (sample: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          你想看什么
        </Label>
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="例如：最近 7 天哪些对话最活跃"
          rows={3}
          autoFocus
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <p className="text-[11px] text-muted-foreground">⌘ / Ctrl + Enter 直接生成</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          试试这些
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_PROMPTS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => onPickSample(sample)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors',
                'hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {sample}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThinkingPanel({
  stage,
  matched,
  prompt,
}: {
  stage: Stage;
  matched: { template: CustomReportTemplate; title: string } | null;
  prompt: string;
}) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-4 py-6">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        {stage === 'thinking' ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Sparkles className="size-5 text-foreground" />
        )}
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        {stage === 'thinking' ? (
          <>
            <p className="text-sm font-medium">正在匹配可用统计</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              理解你说：「{prompt}」
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">已选择「{matched?.title}」模板</p>
            <p className="text-xs text-muted-foreground">正在基于本机微信统计生成报表…</p>
          </>
        )}
      </div>
    </div>
  );
}
