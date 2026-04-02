import type { StageExecutionResultV1 } from '@/lib/team-run/runtime-contracts';

/**
 * A raw trace event emitted by the SDK during agent execution.
 * `type: 'assistant'` — Claude's message (thinking + tool_use + text blocks)
 * `type: 'user'`      — Tool results returned to Claude
 */
export interface RawTraceEvent {
  type: 'assistant' | 'user';
  raw: unknown;
}

/**
 * Message format for step output persistence:
 *
 * First line is a structured header:  <!-- step:roleName:stepId:outcome -->
 * This is invisible in markdown rendering but parseable by the UI.
 * The rest is the actual content as markdown.
 */
export function formatStepOutputMarkdown(
  roleName: string,
  stepId: string,
  result: StageExecutionResultV1,
  traceEvents?: RawTraceEvent[],
): string {
  const parts: string[] = [];

  // Hidden structured header — UI parses this for card metadata
  parts.push(`<!-- step:${encodeField(roleName)}:${encodeField(stepId)}:${result.outcome} -->`);
  parts.push('');

  // Error block
  if (result.outcome === 'failed' || result.outcome === 'blocked') {
    const errMsg = result.error?.message || '步骤执行失败';
    parts.push(`> ${errMsg}`);
    parts.push('');
  }

  // Main summary — this is the actual report content
  const summary = result.summary?.trim();
  if (summary) {
    parts.push(summary);
    parts.push('');
  }

  // Artifacts
  if (result.artifacts && result.artifacts.length > 0) {
    parts.push('---');
    parts.push('');
    parts.push('#### 输出文件');
    parts.push('');
    for (const a of result.artifacts) {
      const sizeStr = a.sizeBytes != null ? ` (${formatBytes(a.sizeBytes)})` : '';
      const kindLabel = { report: '报告', log: '日志', metadata: '元数据', file: '文件' }[a.kind] ?? '文件';
      const path = a.relativePath ? ` \`${a.relativePath}\`` : '';
      parts.push(`- **${a.title}**${path}${sizeStr} — ${kindLabel}`);
    }
    parts.push('');
  }

  // Detail artifact path
  if (result.detailArtifactPath) {
    parts.push(`> 详细结果: \`${result.detailArtifactPath}\``);
    parts.push('');
  }

  // Execution trace (thinking, tool calls, results)
  if (traceEvents && traceEvents.length > 0) {
    const trace = formatExecutionTrace(traceEvents);
    if (trace) {
      parts.push(trace);
      parts.push('');
    }
  }

  // Metrics footer
  if (result.metrics) {
    const m = result.metrics;
    const items: string[] = [];
    if (m.durationMs != null) items.push(`耗时 ${formatDurationMs(m.durationMs)}`);
    if (m.tokensUsed != null) items.push(`${m.tokensUsed.toLocaleString()} tokens`);
    if (m.apiCalls != null) items.push(`${m.apiCalls} 次 API 调用`);
    if (items.length > 0) {
      parts.push(`<sub>${items.join(' · ')}</sub>`);
      parts.push('');
    }
  }

  return parts.join('\n').trim() || '';
}

/** Format the full execution trace (tool calls, results, thinking) as markdown. */
export function formatExecutionTrace(events: RawTraceEvent[]): string {
  if (events.length === 0) return '';

  const sections: string[] = [];
  let toolCallCount = 0;
  let thinkingCount = 0;

  for (const event of events) {
    const raw = event.raw as any;

    if (event.type === 'assistant') {
      const content = raw?.message?.content;
      if (!Array.isArray(content) || content.length === 0) continue;

      const hasToolUse = content.some((b: any) => b.type === 'tool_use');
      const blocks: string[] = [];

      for (const block of content as any[]) {
        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
          thinkingCount++;
          const thinking = truncateTrace(block.thinking.trim(), 1500);
          const quoted = thinking.split('\n').map((l: string) => `> ${l}`).join('\n');
          blocks.push(`> 💭 **思考过程**\n>\n${quoted}`);
        } else if (block.type === 'tool_use' && block.name) {
          toolCallCount++;
          let inputStr: string;
          try { inputStr = JSON.stringify(block.input, null, 2); } catch { inputStr = String(block.input ?? ''); }
          inputStr = truncateTrace(inputStr, 600);
          blocks.push(`**🔧 调用：** \`${block.name}\`\n\`\`\`json\n${inputStr}\n\`\`\``);
        } else if (block.type === 'text' && block.text?.trim() && hasToolUse) {
          // Only show intermediate text blocks (those in messages that also contain tool calls)
          blocks.push(`> ${truncateTrace(block.text.trim(), 500).split('\n').join('\n> ')}`);
        }
      }

      if (blocks.length > 0) sections.push(blocks.join('\n\n'));

    } else if (event.type === 'user' && !(raw as any)?.isSynthetic) {
      const content = raw?.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as any[]) {
        if (block.type !== 'tool_result') continue;
        let resultText: string;
        if (typeof block.content === 'string') {
          resultText = block.content;
        } else if (Array.isArray(block.content)) {
          resultText = (block.content as any[]).filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('\n');
        } else { continue; }

        resultText = resultText.trim();
        if (!resultText) continue;
        resultText = truncateTrace(resultText, 1500);
        sections.push(`**📤 结果：**\n\`\`\`\n${resultText}\n\`\`\``);
      }
    }
  }

  if (sections.length === 0) return '';

  const summaryParts: string[] = [];
  if (toolCallCount > 0) summaryParts.push(`${toolCallCount} 次工具调用`);
  if (thinkingCount > 0) summaryParts.push(`${thinkingCount} 段思考`);
  const summaryLine = summaryParts.length > 0 ? `（${summaryParts.join('，')}）` : '';

  return `---\n\n#### 执行过程${summaryLine}\n\n${sections.join('\n\n')}`;
}

function truncateTrace(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n*...(省略 ${text.length - max} 字)*`;
}

/** Parse the structured header from stored step output. */
export function parseStepHeader(md: string): {
  roleName: string;
  stepId: string;
  outcome: string;
  body: string;
} | null {
  const match = md.match(/^<!--\s*step:(.+?):(.+?):(.+?)\s*-->\s*\n?([\s\S]*)$/);
  if (!match) return null;
  return {
    roleName: decodeField(match[1]),
    stepId: decodeField(match[2]),
    outcome: match[3],
    body: match[4].trim(),
  };
}

/** Also handle the old format: **roleName** · stepId\n\nbody */
export function parseLegacyStepHeader(md: string): {
  roleName: string;
  stepId: string;
  body: string;
} | null {
  const match = md.match(/^\*\*(.+?)\*\*\s*·\s*(\S+)\s*\n([\s\S]*)$/);
  if (!match) return null;
  return {
    roleName: match[1],
    stepId: match[2],
    body: match[3].trim(),
  };
}

function encodeField(s: string): string { return s.replace(/:/g, '：'); }
function decodeField(s: string): string { return s.replace(/：/g, ':'); }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
