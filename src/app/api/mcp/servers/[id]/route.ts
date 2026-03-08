import { NextResponse } from "next/server";
import { getMcpServer, updateMcpServer, deleteMcpServer } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const server = await getMcpServer(id);

    if (!server) {
      return NextResponse.json(
        { error: "Server not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ server });
  } catch (error) {
    console.error("Failed to get MCP server:", error);
    return NextResponse.json(
      { error: "Failed to get MCP server" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getMcpServer(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Server not found" },
        { status: 404 }
      );
    }
    const body = await request.json();
    const { command, args, env, enabled, type, url, headers, description } = body;

    const effectiveType = type || existing.type || 'stdio';
    const effectiveCommand = command ?? existing.command;
    const effectiveUrl = url ?? existing.url;

    if (effectiveType === 'stdio' && !effectiveCommand) {
      return NextResponse.json(
        { error: "Command is required for stdio MCP servers" },
        { status: 400 }
      );
    }
    if ((effectiveType === 'sse' || effectiveType === 'http') && !effectiveUrl) {
      return NextResponse.json(
        { error: "URL is required for sse/http MCP servers" },
        { status: 400 }
      );
    }

    const server = await updateMcpServer(id, {
      command: effectiveCommand,
      args: args || [],
      env: env || {},
      type: effectiveType,
      url: effectiveUrl || '',
      headers: headers || {},
      is_enabled: enabled !== undefined ? enabled : true,
      description,
    });

    return NextResponse.json({ server });
  } catch (error) {
    console.error("Failed to update MCP server:", error);
    return NextResponse.json(
      { error: "Failed to update MCP server" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteMcpServer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete MCP server:", error);
    return NextResponse.json(
      { error: "Failed to delete MCP server" },
      { status: 500 }
    );
  }
}
