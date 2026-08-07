import { NextResponse } from "next/server";
import { getMcpServer } from "@/lib/db";
import { deleteMcpOAuthToken } from "@/lib/db/mcp-oauth";
import { getMcpAuthStatus } from "@/lib/mcp-oauth/token-manager";

/** 查某台远程 MCP 的授权状态。 */
export async function GET(request: Request) {
  const serverId = new URL(request.url).searchParams.get("serverId");
  if (!serverId) {
    return NextResponse.json({ error: "serverId is required" }, { status: 400 });
  }
  const server = getMcpServer(serverId);
  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }
  return NextResponse.json({ status: getMcpAuthStatus(serverId, Boolean(server.url)) });
}

/** 撤销授权(删掉本地令牌)。 */
export async function DELETE(request: Request) {
  const serverId = new URL(request.url).searchParams.get("serverId");
  if (!serverId) {
    return NextResponse.json({ error: "serverId is required" }, { status: 400 });
  }
  deleteMcpOAuthToken(serverId);
  return NextResponse.json({ success: true });
}
