#!/usr/bin/env python3
"""Task Management MCP Server - Create and manage tasks"""
import asyncio
import json
import os
import sys
from typing import Any
from datetime import datetime

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
import httpx

# Log to file for debugging
LOG_FILE = os.path.expanduser('~/.lumos/task-management-mcp.log')

def log(msg):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_msg = f"[{timestamp}] {msg}\n"
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(log_msg)
    except:
        pass
    print(msg, file=sys.stderr, flush=True)

app = Server("task-management")

# Lumos API base URL - dynamically detect
def get_api_base():
    # Priority 1: Explicit LUMOS_API_BASE
    if os.getenv("LUMOS_API_BASE"):
        return os.getenv("LUMOS_API_BASE")

    # Priority 2: Infer from PORT or LUMOS_DEV_SERVER_PORT
    port = os.getenv("LUMOS_DEV_SERVER_PORT") or os.getenv("PORT")
    if port:
        return f"http://localhost:{port}"

    # Priority 3: Default to 3000 (dev) or 43127 (packaged)
    return "http://localhost:3000"

API_BASE = get_api_base()

# Startup log
log(f"[task-management-mcp] Starting server")
log(f"[task-management-mcp] API_BASE: {API_BASE}")


@app.list_tools()
async def list_tools():
    log(f"[task-management-mcp] list_tools called")
    return [
        Tool(
            name="createTask",
            description="Create a new task in Task Management system",
            inputSchema={
                "type": "object",
                "properties": {
                    "taskSummary": {
                        "type": "string",
                        "description": "Task summary (third-person description)"
                    },
                    "requirements": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of specific requirements"
                    },
                    "sessionId": {
                        "type": "string",
                        "description": "Current session ID"
                    }
                },
                "required": ["taskSummary", "requirements", "sessionId"],
            },
        ),
        Tool(
            name="listTasks",
            description="List tasks with optional filters",
            inputSchema={
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string"},
                    "status": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by status: pending, running, completed, failed, cancelled"
                    },
                },
            },
        ),
        Tool(
            name="getTaskDetail",
            description="Get detailed information about a task",
            inputSchema={
                "type": "object",
                "properties": {
                    "taskId": {"type": "string", "description": "Task ID"}
                },
                "required": ["taskId"],
            },
        ),
        Tool(
            name="cancelTask",
            description="Cancel a running or pending task",
            inputSchema={
                "type": "object",
                "properties": {
                    "taskId": {"type": "string"},
                    "reason": {"type": "string", "description": "Cancellation reason"}
                },
                "required": ["taskId"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: Any):
    log(f"[task-management-mcp] Tool called: {name}")
    log(f"[task-management-mcp] Arguments: {json.dumps(arguments, ensure_ascii=False)}")

    async with httpx.AsyncClient() as client:
        if name == "createTask":
            log(f"[task-management-mcp] Creating task...")
            response = await client.post(
                f"{API_BASE}/api/task-management/create",
                json={
                    "taskSummary": arguments["taskSummary"],
                    "requirements": arguments["requirements"],
                    "context": {"sessionId": arguments["sessionId"]}
                },
                timeout=30.0
            )
            if response.status_code != 201:
                error = response.json().get("error", "Unknown error")
                log(f"[task-management-mcp] Create task failed: {error}")
                return [TextContent(type="text", text=f"Error: {error}")]
            result = response.json()
            log(f"[task-management-mcp] Task created: {result.get('taskId')}")
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        elif name == "listTasks":
            params = {}
            if "sessionId" in arguments:
                params["sessionId"] = arguments["sessionId"]
            if "status" in arguments:
                params["status"] = ",".join(arguments["status"])

            response = await client.get(
                f"{API_BASE}/api/task-management/list",
                params=params,
                timeout=30.0
            )
            if response.status_code != 200:
                error = response.json().get("error", "Unknown error")
                return [TextContent(type="text", text=f"Error: {error}")]
            result = response.json()
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        elif name == "getTaskDetail":
            response = await client.get(
                f"{API_BASE}/api/task-management/{arguments['taskId']}",
                timeout=30.0
            )
            if response.status_code != 200:
                error = response.json().get("error", "Task not found")
                return [TextContent(type="text", text=f"Error: {error}")]
            result = response.json()
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        elif name == "cancelTask":
            payload = {"taskId": arguments["taskId"]}
            if "reason" in arguments:
                payload["reason"] = arguments["reason"]

            response = await client.post(
                f"{API_BASE}/api/task-management/{arguments['taskId']}/cancel",
                json=payload,
                timeout=30.0
            )
            if response.status_code != 200:
                error = response.json().get("error", "Failed to cancel task")
                return [TextContent(type="text", text=f"Error: {error}")]
            result = response.json()
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        else:
            raise ValueError(f"Unknown tool: {name}")


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
