import { NextRequest, NextResponse } from 'next/server'
import { testMeshMcpServer } from '@/lib/mesh/mesh-mcp-test'

/** 测试某个 mesh MCP server 能否启动并列出工具。POST { name } → { ok, tools[], error? }。 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { name?: unknown }
  if (typeof body.name !== 'string' || !body.name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const result = await testMeshMcpServer(body.name)
  return NextResponse.json(result)
}
