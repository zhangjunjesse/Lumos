import { NextResponse } from "next/server";
import { beginAuthorization } from "@/lib/mcp-oauth/authorize";

/** 发起远程 MCP 的 OAuth 授权,返回要在浏览器里打开的地址。 */
export async function POST(request: Request) {
  try {
    const { serverId } = await request.json();
    if (!serverId) {
      return NextResponse.json({ error: "serverId is required" }, { status: 400 });
    }
    const { authorizationUrl } = await beginAuthorization(serverId);
    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    // 发现/注册失败的原因对用户有用(地址错了、服务器不支持自动注册…),原样透出
    const message = error instanceof Error ? error.message : "发起授权失败";
    console.error("[mcp-oauth] begin authorization failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
