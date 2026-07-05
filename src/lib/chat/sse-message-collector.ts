import type { MessageContentBlock, SSEEvent, TokenUsage } from '@/types';

export interface CollectedAssistantSseMessage {
  contentBlocks: MessageContentBlock[];
  tokenUsage: TokenUsage | null;
}

export interface AssistantSseCollectorCallbacks {
  onSdkSessionId?: (sessionId: string) => void;
  onResolvedModel?: (model: string) => void;
}

export async function collectAssistantSseMessage(
  stream: ReadableStream<string>,
  callbacks: AssistantSseCollectorCallbacks = {},
): Promise<CollectedAssistantSseMessage> {
  const reader = stream.getReader();
  const contentBlocks: MessageContentBlock[] = [];
  const seenToolUseIds = new Set<string>();
  const seenToolResultIds = new Set<string>();
  let currentText = '';
  let tokenUsage: TokenUsage | null = null;
  let buffer = '';

  const flushText = () => {
    if (!currentText.trim()) return;
    contentBlocks.push({ type: 'text', text: currentText });
    currentText = '';
  };

  const handleEvent = (event: SSEEvent) => {
    if (event.type === 'permission_request' || event.type === 'tool_output') {
      return;
    }
    if (event.type === 'text') {
      currentText += event.data;
      return;
    }
    if (event.type === 'tool_use_summary') {
      flushText();
      try {
        const summaryData = JSON.parse(event.data);
        const summary = typeof summaryData.summary === 'string' ? summaryData.summary.trim() : '';
        if (summary) contentBlocks.push({ type: 'reasoning', summary });
      } catch {
        const summary = event.data.trim();
        if (summary) contentBlocks.push({ type: 'reasoning', summary });
      }
      return;
    }
    if (event.type === 'tool_use') {
      flushText();
      try {
        const toolData = JSON.parse(event.data);
        if (typeof toolData.id !== 'string' || seenToolUseIds.has(toolData.id)) return;
        seenToolUseIds.add(toolData.id);
        contentBlocks.push({
          type: 'tool_use',
          id: toolData.id,
          name: typeof toolData.name === 'string' ? toolData.name : 'tool',
          input: toolData.input,
        });
      } catch {
        // ignore malformed tool_use
      }
      return;
    }
    if (event.type === 'tool_result') {
      try {
        const resultData = JSON.parse(event.data);
        if (typeof resultData.tool_use_id !== 'string' || seenToolResultIds.has(resultData.tool_use_id)) return;
        seenToolResultIds.add(resultData.tool_use_id);
        contentBlocks.push({
          type: 'tool_result',
          tool_use_id: resultData.tool_use_id,
          content: String(resultData.content ?? ''),
          is_error: resultData.is_error || false,
        });
      } catch {
        // ignore malformed tool_result
      }
      return;
    }
    if (event.type === 'status') {
      try {
        const statusData = JSON.parse(event.data);
        if (typeof statusData.session_id === 'string') callbacks.onSdkSessionId?.(statusData.session_id);
        if (typeof statusData.model === 'string') callbacks.onResolvedModel?.(statusData.model);
      } catch {
        // ignore malformed status
      }
      return;
    }
    if (event.type === 'result') {
      try {
        const resultData = JSON.parse(event.data);
        if (resultData.usage) tokenUsage = resultData.usage;
        if (typeof resultData.session_id === 'string') callbacks.onSdkSessionId?.(resultData.session_id);
      } catch {
        // ignore malformed result
      }
    }
  };

  const processLine = (line: string) => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalized.startsWith('data: ')) return;
    try {
      handleEvent(JSON.parse(normalized.slice(6)) as SSEEvent);
    } catch {
      // ignore malformed SSE frames
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer) processLine(buffer);
        break;
      }

      buffer += value;
      const lastNewline = buffer.lastIndexOf('\n');
      if (lastNewline === -1) continue;
      const complete = buffer.slice(0, lastNewline);
      buffer = buffer.slice(lastNewline + 1);
      for (const line of complete.split('\n')) processLine(line);
    }
  } catch {
    // Best-effort persistence: return whatever was parsed before the stream broke.
  } finally {
    reader.releaseLock();
  }

  flushText();
  return { contentBlocks, tokenUsage };
}
