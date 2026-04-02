import { NextResponse } from 'next/server';
import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';
import { resolveMessagesUrl } from '@/lib/provider-model-discovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProviderTestPayload {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

async function parseAnthropicError(response: Response): Promise<string> {
  try {
    const body = await response.json() as {
      error?: { message?: string };
      message?: string;
    };
    return body.error?.message || body.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function POST(request: Request) {
  try {
    const { apiKey, baseUrl, model } = await request.json() as ProviderTestPayload;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key is required' },
        { status: 400 }
      );
    }

    const messagesUrl = resolveMessagesUrl(baseUrl || 'https://api.anthropic.com');
    const res = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || BUILTIN_CLAUDE_MODEL_IDS.haiku,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (!res.ok) {
      const errorMessage = await parseAnthropicError(res);
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[Provider Test] Connection failed:', error);

    const errorMessage = error instanceof Error ? error.message : 'Connection failed';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
