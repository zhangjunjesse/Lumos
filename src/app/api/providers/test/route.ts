import { NextResponse } from 'next/server';
import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProviderTestPayload {
  apiKey?: string;
  baseUrl?: string;
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
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
    const { apiKey, baseUrl } = await request.json() as ProviderTestPayload;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key is required' },
        { status: 400 }
      );
    }

    const apiBase = normalizeBaseUrl(baseUrl);
    const res = await fetch(`${apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: BUILTIN_CLAUDE_MODEL_IDS.haiku,
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
