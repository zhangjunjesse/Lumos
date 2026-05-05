import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';

import {
  AppBuilderAssistantError,
  runAppBuilderAssistantTurn,
} from '@/lib/app/builder/assistant-runtime';

const requestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    const result = await runAppBuilderAssistantTurn({
      sessionId: id,
      userMessage: input.message,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof AppBuilderAssistantError ? error.status : 500;
    const message = error instanceof Error ? error.message : '应用开发助手调用失败';
    return NextResponse.json({ error: message }, { status });
  }
}
