import { NextRequest, NextResponse } from 'next/server';
import {
  controlDeepSearchToolRun,
  deepSearchToolRequestSchema,
  getDeepSearchToolResult,
  startDeepSearchTool,
} from '@/lib/deepsearch/tool-facade';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = deepSearchToolRequestSchema.parse(body);

    switch (input.action) {
      case 'start':
        return NextResponse.json({ result: await startDeepSearchTool(input) });
      case 'get_result':
        return NextResponse.json({ result: await getDeepSearchToolResult(input.runId) });
      case 'pause':
      case 'resume':
      case 'cancel':
        return NextResponse.json({ result: await controlDeepSearchToolRun(input.action, input.runId) });
      default:
        return NextResponse.json({ error: 'Unsupported DeepSearch tool action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute DeepSearch tool action';
    const status = message === 'DeepSearch run not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
