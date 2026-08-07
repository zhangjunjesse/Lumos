import { NextRequest, NextResponse } from 'next/server';
import type {
  MCPConfigResponse,
  ErrorResponse,
  SuccessResponse,
} from '@/types';
import type { McpAuthStatus } from '@/lib/mcp-oauth/types';
import { getMcpAuthStatus } from '@/lib/mcp-oauth/token-manager';

import {
  getAllMcpServers,
  createMcpServer,
  updateMcpServer,
  getMcpServerByNameAndScope,
  toggleMcpServerEnabled,
  parseMcpStringArray,
  parseMcpStringMap,
} from '@/lib/db';

function parseJsonArray(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function GET(): Promise<NextResponse<MCPConfigResponse | ErrorResponse>> {
  try {
    // Load all MCP servers from database (including scope info)
    const servers = getAllMcpServers();

    // Convert to the format expected by the UI
    const mcpServers: Record<string, {
      id: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      scope: 'builtin' | 'user';
      description: string;
      is_enabled: boolean;
      type?: 'sse' | 'http';
      runMode?: 'on_demand' | 'keep_alive';
      runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
      url?: string;
      headers?: Record<string, string>;
      authStatus?: McpAuthStatus;
      health?: {
        status: 'unknown' | 'ok' | 'failed' | 'skipped';
        checkedAt?: string;
        error?: string;
        message?: string;
        tools?: string[];
        transport?: 'stdio' | 'sse' | 'http';
      };
    }> = {};
    for (const server of servers) {
      const entry: {
        id: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        scope: 'builtin' | 'user';
        description: string;
        is_enabled: boolean;
        type?: 'sse' | 'http';
        runMode?: 'on_demand' | 'keep_alive';
        runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
        url?: string;
        headers?: Record<string, string>;
        authStatus?: McpAuthStatus;
        health?: {
          status: 'unknown' | 'ok' | 'failed' | 'skipped';
          checkedAt?: string;
          error?: string;
          message?: string;
          tools?: string[];
          transport?: 'stdio' | 'sse' | 'http';
        };
      } = {
        id: server.id,
        command: server.command,
        args: parseMcpStringArray(server.args),
        env: parseMcpStringMap(server.env),
        scope: server.scope,
        description: server.description,
        is_enabled: server.is_enabled === 1,
      };
      const type = server.type || 'stdio';
      if (type === 'sse' || type === 'http') entry.type = type;
      entry.runMode = server.run_mode || 'on_demand';
      entry.runtime = server.runtime_kind || 'auto';
      if (server.url) entry.url = server.url;
      const headers = parseMcpStringMap(server.headers);
      if (Object.keys(headers).length > 0) entry.headers = headers;
      // 远程 MCP 才有授权一说;只读本地令牌,不发网络探测(列表要快)
      if (server.url) entry.authStatus = getMcpAuthStatus(server.id, true);
      const healthStatus = server.health_status || 'unknown';
      if (healthStatus !== 'unknown' || server.health_checked_at) {
        entry.health = {
          status: healthStatus as 'unknown' | 'ok' | 'failed' | 'skipped',
          ...(server.health_checked_at ? { checkedAt: server.health_checked_at } : {}),
          ...(server.health_error ? { error: server.health_error } : {}),
          ...(server.health_message ? { message: server.health_message } : {}),
          ...(server.health_transport === 'stdio' || server.health_transport === 'sse' || server.health_transport === 'http'
            ? { transport: server.health_transport }
            : {}),
          tools: parseJsonArray(server.health_tools),
        };
      }
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
      runMode: server.runMode || 'on_demand',
      runtime: server.runtime || 'auto',
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
        runMode: server.runMode,
        runtime: server.runtime,
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
        args: server.args || (existingBuiltin ? parseMcpStringArray(existingBuiltin.args) : []),
        env: server.env || (existingBuiltin ? parseMcpStringMap(existingBuiltin.env) : {}),
        type: server.type || existingBuiltin?.type || 'stdio',
        runMode: server.runMode || existingBuiltin?.run_mode || 'on_demand',
        runtime: server.runtime || existingBuiltin?.runtime_kind || 'auto',
        url: server.url || existingBuiltin?.url || '',
        headers: server.headers || (existingBuiltin ? parseMcpStringMap(existingBuiltin.headers) : {}),
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
