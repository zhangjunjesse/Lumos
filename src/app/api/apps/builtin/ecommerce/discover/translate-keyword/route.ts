import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  EcommerceLlmUnavailableError,
  generateStructured,
} from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  keyword: z.string().trim().min(1).max(120),
  target_language: z.string().trim().min(1).max(80),
});

const translationSchema = z.object({
  translated_keyword: z.string().trim().min(1).max(120),
});

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: '关键词和目标语言不能为空。' }, { status: 400 });
  }

  try {
    const data = await generateStructured({
      schema: translationSchema,
      system:
        'You translate ecommerce marketplace search keywords. Return strict JSON only. Keep the result short, natural, and useful as a marketplace search query. Do not add explanations, punctuation, quotes, hashtags, or extra variants.',
      prompt: [
        `Source keyword: ${parsed.data.keyword}`,
        `Target language: ${parsed.data.target_language}`,
        '',
        'Translate the source keyword into one concise marketplace search phrase in the target language.',
        'Preserve product intent and buyer/search wording. If the source is already in the target language, normalize it but keep the same meaning.',
      ].join('\n'),
      maxTokens: 256,
    });
    return NextResponse.json({ translated_keyword: data.translated_keyword.trim() });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
