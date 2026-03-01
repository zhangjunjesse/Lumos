import { NextResponse } from "next/server";
import { getAllMcpServers, createMcpServer } from "@/lib/db";

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
    const { name, command, args, env, scope } = body;

    if (!name || !command) {
      return NextResponse.json(
        { error: "Name and command are required" },
        { status: 400 }
      );
    }

    const server = await createMcpServer({
      name,
      command,
      args: args || [],
      env: env || {},
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
