import { NextRequest, NextResponse } from 'next/server';
import { generateCapabilityDraft } from '@/lib/capability/authoring-agent';
import { saveDraft } from '@/lib/db/capabilities';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userPrompt, conversationHistory, providerId, model } = body;

    const normalizedPrompt = typeof userPrompt === 'string' ? userPrompt : '';
    const normalizedHistory = Array.isArray(conversationHistory) ? conversationHistory : [];

    if (!normalizedPrompt.trim() && normalizedHistory.length === 0) {
      return NextResponse.json(
        { error: 'conversationHistory or userPrompt is required' },
        { status: 400 }
      );
    }

    const result = await generateCapabilityDraft({
      userPrompt: normalizedPrompt,
      conversationHistory: normalizedHistory,
      providerId,
      model,
    });

    saveDraft(result.draft);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to generate capability draft:', error);
    return NextResponse.json(
      { error: 'Failed to generate capability draft' },
      { status: 500 }
    );
  }
}
