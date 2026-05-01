import { NextRequest, NextResponse } from 'next/server';
import { getMcpServerByNameAndScope, mcpServerRecordToConfig, updateMcpServerHealth } from '@/lib/db';
import { smokeTestMcpServerConfig, type McpSmokeTestResult } from '@/lib/mcp-smoke-test';

export const runtime = 'nodejs';

function healthFromResult(result: McpSmokeTestResult) {
  const health = {
    status: result.ok ? (result.skipped ? 'skipped' as const : 'ok' as const) : 'failed' as const,
    checked_at: new Date().toISOString(),
    error: result.ok ? '' : (result.error || 'MCP smoke test failed'),
    message: result.reason || '',
    tools: Array.isArray(result.tools) ? result.tools : [],
  };
  return result.transport ? { ...health, transport: result.transport } : health;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const scope = body?.scope === 'builtin' ? 'builtin' : 'user';
  const record = name
    ? getMcpServerByNameAndScope(name, scope)
      || getMcpServerByNameAndScope(name, scope === 'user' ? 'builtin' : 'user')
    : undefined;

  if (name && !record) {
    return NextResponse.json(
      {
        ok: false,
        error: `MCP server "${name}" not found`,
      },
      { status: 404 },
    );
  }

  const serverToTest = record ? mcpServerRecordToConfig(record) : body?.server;
  const result = await smokeTestMcpServerConfig(serverToTest);

  if (record) {
    updateMcpServerHealth(record.id, healthFromResult(result));
  }

  return NextResponse.json(result, { status: 200 });
}
