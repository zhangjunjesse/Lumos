import { NextRequest, NextResponse } from 'next/server';
import type {
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
    const mcpServers: Record<string, {
      command: string;
      args: string[];
      env: Record<string, string>;
      scope: 'builtin' | 'user';
      description: string;
      is_enabled: boolean;
      type?: 'sse' | 'http';
      url?: string;
      headers?: Record<string, string>;
    }> = {};
    for (const server of servers) {
      const entry: {
        command: string;
        args: string[];
        env: Record<string, string>;
        scope: 'builtin' | 'user';
        description: string;
        is_enabled: boolean;
        type?: 'sse' | 'http';
        url?: string;
        headers?: Record<string, string>;
      } = {
        command: server.command,
        args: JSON.parse(server.args || '[]'),
        env: JSON.parse(server.env || '{}'),
        scope: server.scope,
        description: server.description,
        is_enabled: server.is_enabled === 1,
      };
      const type = server.type || 'stdio';
      if (type === 'sse' || type === 'http') entry.type = type;
      if (server.url) entry.url = server.url;
      const headers = JSON.parse(server.headers || '{}');
      if (Object.keys(headers).length > 0) entry.headers = headers;
      mcpServers[server.name] = entry;
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
      command: server.command || '',
      args: server.args || [],
      env: server.env || {},
      type: server.type || 'stdio',
      url: server.url || '',
      headers: server.headers || {},
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

    // Prefer user-scope override; fallback to builtin.
    // IMPORTANT: When editing builtin servers, we write to a user-scope
    // override instead of mutating builtin rows. This prevents builtin
    // resource refresh from resetting user custom env/args.
    const existingUser = getMcpServerByNameAndScope(name, 'user');
    const existingBuiltin = getMcpServerByNameAndScope(name, 'builtin');
    if (!existingUser && !existingBuiltin) {
      return NextResponse.json(
        { error: `MCP server "${name}" not found` },
        { status: 404 }
      );
    }

    if (existingUser) {
      updateMcpServer(existingUser.id, {
        description: server.description,
        command: server.command,
        args: server.args,
        env: server.env,
        type: server.type,
        url: server.url,
        headers: server.headers,
      });
    } else {
      // Create user override for builtin server
      createMcpServer({
        name,
        scope: 'user',
        description: server.description || existingBuiltin?.description || `MCP server: ${name}`,
        command: server.command || existingBuiltin?.command || '',
        args: server.args || (existingBuiltin ? JSON.parse(existingBuiltin.args || '[]') as string[] : []),
        env: server.env || (existingBuiltin ? JSON.parse(existingBuiltin.env || '{}') as Record<string, string> : {}),
        type: server.type || existingBuiltin?.type || 'stdio',
        url: server.url || existingBuiltin?.url || '',
        headers: server.headers || (existingBuiltin ? JSON.parse(existingBuiltin.headers || '{}') as Record<string, string> : {}),
        is_enabled: existingBuiltin ? existingBuiltin.is_enabled === 1 : true,
        source: 'manual',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update MCP server' },
      { status: 500 }
    );
  }
}
