import { NextResponse } from 'next/server';
import { listWorkflowAgentRoleProfiles } from '@/lib/workflow/agent-config';

export async function GET() {
  try {
    return NextResponse.json({
      roles: listWorkflowAgentRoleProfiles(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load workflow agent roles';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
