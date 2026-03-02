import { NextRequest, NextResponse } from 'next/server';
import type {
  MCPServerConfig,
  MCPConfigResponse,
  ErrorResponse,
  SuccessResponse,
} from '@/types';

import {
  getAllMcpServers,
  createMcpServer,
  updateMcpServer,
  getMcpServerByNameAndScope,
  toggleMcpServerEnabled,
} from '@/lib/db';

export async function GET(): Promise<NextResponse<MCPConfigResponse | ErrorResponse>> {
  try {
    // Load all MCP servers from database (including scope info)
    const servers = getAllMcpServers();

    // Convert to the format expected by the UI
    const mcpServers: Record<string, any> = {};
    for (const server of servers) {
      mcpServers[server.name] = {
        command: server.command,
        args: JSON.parse(server.args || '[]'),
        env: JSON.parse(server.env || '{}'),
        scope: server.scope,
        description: server.description,
        is_enabled: server.is_enabled === 1,
      };
    }

    return NextResponse.json({ mcpServers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read MCP config' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, server } = body;

    if (!name || !server) {
      return NextResponse.json(
        { error: 'Missing required fields: name, server' },
        { status: 400 }
      );
    }

    // Check if server already exists
    const existing = getMcpServerByNameAndScope(name, 'user');
    if (existing) {
      return NextResponse.json(
        { error: `MCP server "${name}" already exists` },
        { status: 409 }
      );
    }

    // Create new server with scope=user
    createMcpServer({
      name,
      scope: 'user',
      description: server.description || `MCP server: ${name}`,
      command: server.command || 'node',
      args: server.args || [],
      env: server.env || {},
      is_enabled: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add MCP server' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, scope, is_enabled } = body;

    if (!name || typeof is_enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields: name, is_enabled' },
        { status: 400 }
      );
    }

    const server = getMcpServerByNameAndScope(name, scope || 'user') ||
      getMcpServerByNameAndScope(name, scope === 'user' ? 'builtin' : 'user');

    if (!server) {
      return NextResponse.json(
        { error: `MCP server "${name}" not found` },
        { status: 404 }
      );
    }

    toggleMcpServerEnabled(server.id, is_enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle MCP server' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await request.json();
    const { name, server } = body;

    if (!name || !server) {
      return NextResponse.json(
        { error: 'Missing required fields: name, server' },
        { status: 400 }
      );
    }

    // Only allow updating user-scope servers
    const existing = getMcpServerByNameAndScope(name, 'user');
    if (!existing) {
      return NextResponse.json(
        { error: `MCP server "${name}" not found or is not editable` },
        { status: 404 }
      );
    }

    // Update server
    updateMcpServer(existing.id, {
      description: server.description,
      command: server.command,
      args: server.args,
      env: server.env,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update MCP server' },
      { status: 500 }
    );
  }
}
