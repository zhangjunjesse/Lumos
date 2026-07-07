import { collectAssistantSseMessage } from '../sse-message-collector';
import { LEAKED_TOOL_INVOCATION_MESSAGE } from '../tool-trace-sanitizer';
import type { SSEEvent } from '@/types';

function frame(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function streamFromChunks(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('collectAssistantSseMessage', () => {
  it('keeps tool_use and tool_result when an SSE frame is split across chunks', async () => {
    const toolUse = frame({
      type: 'tool_use',
      data: JSON.stringify({ id: 'toolu_1', name: 'Bash', input: { command: 'echo ok' } }),
    });
    const toolResult = frame({
      type: 'tool_result',
      data: JSON.stringify({ tool_use_id: 'toolu_1', content: 'ok', is_error: false }),
    });

    const splitAt = Math.floor(toolUse.length / 2);
    const result = await collectAssistantSseMessage(streamFromChunks([
      frame({ type: 'text', data: 'before ' }),
      toolUse.slice(0, splitAt),
      toolUse.slice(splitAt),
      toolResult,
      frame({ type: 'text', data: ' after' }),
    ]));

    expect(result.contentBlocks).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo ok' } },
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false },
      { type: 'text', text: ' after' },
    ]);
  });

  it('deduplicates duplicate tool_result frames for the same tool id', async () => {
    const result = await collectAssistantSseMessage(streamFromChunks([
      frame({
        type: 'tool_use',
        data: JSON.stringify({ id: 'toolu_1', name: 'mcp__x__status', input: {} }),
      }),
      frame({
        type: 'tool_result',
        data: JSON.stringify({ tool_use_id: 'toolu_1', content: 'first' }),
      }),
      frame({
        type: 'tool_result',
        data: JSON.stringify({ tool_use_id: 'toolu_1', content: 'second' }),
      }),
    ]));

    expect(result.contentBlocks).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'mcp__x__status', input: {} },
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'first', is_error: false },
    ]);
  });

  it('blocks leaked tool invocation text from being stored as a normal answer', async () => {
    const result = await collectAssistantSseMessage(streamFromChunks([
      frame({ type: 'text', data: '我准备执行。\n' }),
      frame({ type: 'text', data: 'call true\n' }),
      frame({ type: 'text', data: '继续。' }),
    ]));

    expect(result.contentBlocks).toEqual([
      { type: 'text', text: '我准备执行。继续。' },
      { type: 'text', text: `**Error:** ${LEAKED_TOOL_INVOCATION_MESSAGE}` },
    ]);
  });
});
