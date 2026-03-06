import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { apiKey, baseUrl } = await request.json();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key is required' },
        { status: 400 }
      );
    }

    // Test connection by making a simple API call
    const client = new Anthropic({
      apiKey,
      baseURL: baseUrl || 'https://api.anthropic.com',
    });

    // Use a minimal request to test the connection
    await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }],
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Provider Test] Connection failed:', error);

    const errorMessage = error?.message || 'Connection failed';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
