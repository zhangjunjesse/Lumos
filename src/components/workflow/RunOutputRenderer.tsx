'use client';

import { memo, useMemo, useState } from 'react';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { streamdownCode } from '@/lib/streamdown-code';
import { Badge } from '@/components/ui/badge';
import { parseStepHeader, parseLegacyStepHeader } from '@/lib/workflow/step-output-formatter';

const plugins = { cjk, code: streamdownCode, math, mermaid };

interface DbMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

function extractMarkdown(content: string): string {
  try {
    const blocks = JSON.parse(content) as Array<{ type: string; text?: string }>;
    if (Array.isArray(blocks)) {
      return blocks
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text as string)
        .join('\n\n')
        .trim();
    }
  } catch { /* not JSON */ }
  return content.trim();
}

interface ParsedStep {
  roleName: string | null;
  stepId: string | null;
  outcome: string | null;
  summary: string;
  traceSection: string;
}

/** Split markdown body into summary (above ---) and trace (below ---) */
function splitSummaryAndTrace(body: string): { summary: string; trace: string } {
  const divider = body.indexOf('\n---\n');
  if (divider === -1) return { summary: body, trace: '' };
  return { summary: body.slice(0, divider).trim(), trace: body.slice(divider + 5).trim() };
}

function parseMessage(md: string): ParsedStep {
  const newFmt = parseStepHeader(md);
  if (newFmt) {
    const { summary, trace } = splitSummaryAndTrace(newFmt.body);
    return { roleName: newFmt.roleName, stepId: newFmt.stepId, outcome: newFmt.outcome, summary, traceSection: trace };
  }
  const legacy = parseLegacyStepHeader(md);
  if (legacy) {
    const { summary, trace } = splitSummaryAndTrace(legacy.body);
    return { roleName: legacy.roleName, stepId: legacy.stepId, outcome: null, summary, traceSection: trace };
  }
  return { roleName: null, stepId: null, outcome: null, summary: md, traceSection: '' };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const OUTCOME_CFG: Record<string, { label: string; cls: string }> = {
  done: { label: '完成', cls: 'bg-green-500/10 text-green-700 border-green-500/20' },
  failed: { label: '失败', cls: 'bg-red-500/10 text-red-700 border-red-500/20' },
  blocked: { label: '阻塞', cls: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
};

const StepCard = memo(({ message, index }: { message: DbMessage; index: number }) => {
  const md = extractMarkdown(message.content);
  const parsed = useMemo(() => parseMessage(md), [md]);
  const [traceOpen, setTraceOpen] = useState(false);

  if (!parsed.summary && !parsed.roleName) return null;

  const outcomeCfg = parsed.outcome ? OUTCOME_CFG[parsed.outcome] : null;

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-3 border-b border-border/40 bg-muted/20 flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {index + 1}
        </div>
        {parsed.roleName && (
          <span className="text-sm font-medium truncate">{parsed.roleName}</span>
        )}
        {parsed.stepId && (
          <span className="text-[10px] text-muted-foreground font-mono">{parsed.stepId}</span>
        )}
        {outcomeCfg && (
          <Badge className={`border text-[10px] px-1.5 py-0 h-4 shrink-0 ${outcomeCfg.cls}`}>
            {outcomeCfg.label}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatTime(message.created_at)}</span>
      </div>

      {/* Summary body */}
      {parsed.summary && (
        <div className="px-5 py-4">
          <Streamdown
            className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 leading-relaxed"
            plugins={plugins}
          >
            {parsed.summary}
          </Streamdown>
        </div>
      )}

      {/* Collapsible trace section */}
      {parsed.traceSection && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setTraceOpen(v => !v)}
            className="w-full px-5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center gap-2"
          >
            <span className={`transition-transform ${traceOpen ? 'rotate-90' : ''}`}>&#9654;</span>
            执行过程详情
          </button>
          {traceOpen && (
            <div className="px-5 py-3 bg-muted/10 max-h-[500px] overflow-y-auto">
              <Streamdown
                className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-xs leading-relaxed"
                plugins={plugins}
              >
                {parsed.traceSection}
              </Streamdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
StepCard.displayName = 'StepCard';

interface RunOutputRendererProps {
  messages: DbMessage[];
}

export function RunOutputRenderer({ messages }: RunOutputRendererProps) {
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  if (assistantMessages.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50">
        暂无输出内容
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {assistantMessages.map((m, i) => <StepCard key={m.id} message={m} index={i} />)}
    </div>
  );
}
