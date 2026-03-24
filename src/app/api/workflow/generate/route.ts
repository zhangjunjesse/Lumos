import { NextRequest, NextResponse } from 'next/server';
import { handleGenerateWorkflowTool } from '../../../../lib/workflow/mcp-tool';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = handleGenerateWorkflowTool(body);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[workflow-api] Failed to generate workflow:', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate workflow' },
      { status: 400 },
    );
  }
}
