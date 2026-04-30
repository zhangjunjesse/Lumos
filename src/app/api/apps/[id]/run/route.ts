import { type NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/apps/<id>/run
 *
 * Body: { workflowId, inputs?, pageId? }
 *
 * v1 returns 503 Not Ready. The workflow bridge contract is fixed (see
 * src/lib/app/runtime/workflow-bridge.ts) and the backing integration with
 * src/lib/workflow/engine.ts lands in M3. Surfacing a clean 503 here lets
 * client code wire end-to-end now and the engine swap is transparent.
 */

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  return NextResponse.json(
    {
      ok: false,
      error: 'WorkflowBridgeNotReady',
      message:
        'Workflow execution for app-bundled workflows lands in M3. ' +
        'See src/lib/app/runtime/workflow-bridge.ts for the contract.',
      appId: id,
    },
    { status: 503 },
  );
}
