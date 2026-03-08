import { NextResponse } from "next/server";
import { getAllMcpServers, createMcpServer, getMcpServerByNameAndScope } from "@/lib/db";

export async function GET() {
  try {
    const servers = await getAllMcpServers();
    return NextResponse.json({ servers });
  } catch (error) {
    console.error("Failed to get MCP servers:", error);
    return NextResponse.json(
      { error: "Failed to get MCP servers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, command, args, env, scope, type, url, headers, description } = body;
    const effectiveType = type || 'stdio';

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }
    if (effectiveType === 'stdio' && !command) {
      return NextResponse.json(
        { error: "Command is required for stdio MCP servers" },
        { status: 400 }
      );
    }
    if ((effectiveType === 'sse' || effectiveType === 'http') && !url) {
      return NextResponse.json(
        { error: "URL is required for sse/http MCP servers" },
        { status: 400 }
      );
    }

    const existing = getMcpServerByNameAndScope(name, scope || "user");
    if (existing) {
      return NextResponse.json(
        { error: `MCP server \"${name}\" already exists` },
        { status: 409 }
      );
    }

    const server = await createMcpServer({
      name,
      command,
      args: args || [],
      env: env || {},
      type: effectiveType,
      url: url || '',
      headers: headers || {},
      description: description || '',
      scope: scope || "user",
      is_enabled: true,
    });

    return NextResponse.json({ server });
  } catch (error) {
    console.error("Failed to add MCP server:", error);
    return NextResponse.json(
      { error: "Failed to add MCP server" },
      { status: 500 }
    );
  }
}
