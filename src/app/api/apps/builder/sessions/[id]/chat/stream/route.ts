import { z } from 'zod';
import { type NextRequest } from 'next/server';

import {
  AppBuilderAssistantError,
  type AppBuilderToolTraceEvent,
  runAppBuilderAssistantTurn,
} from '@/lib/app/builder/assistant-runtime';
import type { BuilderMessage } from '@/lib/app/builder/session';
import { formatBuilderMessageForChat } from '@/lib/chat/app-builder-session';
import { addMessage } from '@/lib/db';
import type { SSEEvent } from '@/types';

const requestSchema = z.object({
  message: z.string().trim().min(1).max(8000).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
  session_id: z.string().trim().min(1).optional(),
  provider_id: z.string().trim().optional(),
  model: z.string().trim().optional(),
}).refine((value) => value.message || value.content, {
  message: 'message or content required',
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const input = requestSchema.parse(await request.json());
  const userMessage = input.message || input.content || '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: SSEEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      const emitStatus = (message: string) => {
        emit({ type: 'status', data: message });
      };
      const emitToolTrace = (() => {
        let index = 0;
        return (event: AppBuilderToolTraceEvent) => {
          index += 1;
          const toolUseId = `app-builder-tool-${index}`;
          emit({
            type: 'tool_use',
            data: JSON.stringify({
              id: toolUseId,
              name: event.tool || 'app_builder_tool',
              input: {
                summary: event.summary,
                files: event.files,
              },
            }),
          });
          emit({
            type: 'tool_result',
            data: JSON.stringify({
              tool_use_id: toolUseId,
              content: event.summary || (event.ok ? '完成' : '失败'),
              is_error: !event.ok,
            }),
          });
        };
      })();

      if (input.session_id) {
        addMessage(input.session_id, 'user', userMessage);
      }

      void runAppBuilderAssistantTurn({
        sessionId: id,
        userMessage,
        providerId: input.provider_id,
        model: input.model,
        stream: true,
        events: {
          status: emitStatus,
          trace: emitToolTrace,
        },
      })
        .then((result) => {
          const assistantText = formatBuilderMessageForChat(result.message as BuilderMessage).trim();
          if (assistantText) {
            emit({ type: 'text', data: assistantText });
            if (input.session_id) {
              addMessage(input.session_id, 'assistant', assistantText);
            }
          }
          emit({ type: 'result', data: JSON.stringify({ usage: null }) });
          emit({ type: 'done', data: '' });
          controller.close();
        })
        .catch((error) => {
          const status = error instanceof AppBuilderAssistantError ? error.status : 500;
          const message = error instanceof Error ? error.message : '应用开发助手调用失败';
          const text = `${message}${status ? ` (${status})` : ''}`;
          emit({ type: 'error', data: text });
          if (input.session_id) {
            addMessage(input.session_id, 'assistant', `**Error:** ${text}`);
          }
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}
