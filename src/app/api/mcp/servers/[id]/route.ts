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
    const body = await request.json();
    const { name, command, args, env, enabled } = body;

    if (!name || !command) {
      return NextResponse.json(
        { error: "Name and command are required" },
        { status: 400 }
      );
    }

    const server = await updateMcpServer(id, {
      name,
      command,
      args: args || [],
      env: env || {},
      enabled: enabled !== undefined ? enabled : true,
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
