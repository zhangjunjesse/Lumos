import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse, SuccessResponse } from '@/types';
import { getMcpServerByNameAndScope, deleteMcpServer } from '@/lib/db';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { name } = await params;
    const serverName = decodeURIComponent(name);

    // Only allow deleting user-scope servers
    const existing = getMcpServerByNameAndScope(serverName, 'user');
    if (!existing) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found or is not deletable` },
        { status: 404 }
      );
    }

    deleteMcpServer(existing.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete MCP server' },
      { status: 500 }
    );
  }
}
