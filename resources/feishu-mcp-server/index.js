#!/usr/bin/env node
/**
 * 飞书 MCP Server 入口
 * 通过 stdio 传输注册所有飞书工具到 MCP Server
 */
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

// 导入所有工具
import * as docRead from './tools/doc-read.js';
import * as docGetBlocks from './tools/doc-get-blocks.js';
import * as docEdit from './tools/doc-edit.js';
import * as docAppend from './tools/doc-append.js';
import * as docCreate from './tools/doc-create.js';
import * as docOverwrite from './tools/doc-overwrite.js';
import * as sheetRead from './tools/sheet-read.js';
import * as sheetAppendRows from './tools/sheet-append-rows.js';
import * as sheetUpdateCells from './tools/sheet-update-cells.js';
import * as imageList from './tools/image-list.js';
import * as imageDownload from './tools/image-download.js';
import * as driveList from './tools/drive-list.js';
import * as driveSearch from './tools/drive-search.js';
import * as wikiListSpaces from './tools/wiki-list-spaces.js';
import * as authStatus from './tools/auth-status.js';

// 工具注册表
const tools = [
  docRead, docGetBlocks, docEdit, docAppend, docCreate, docOverwrite,
  sheetRead, sheetAppendRows, sheetUpdateCells,
  imageList, imageDownload,
  driveList, driveSearch, wikiListSpaces,
  authStatus
];
const toolMap = new Map(tools.map(t => [t.name, t]));

// 创建 Server 实例（低级 API，支持原生 JSON Schema）
const server = new Server(
  { name: 'feishu-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// 处理 tools/list 请求
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema
  }))
}));

// 处理 tools/call 请求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolMap.get(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `未知工具: ${name}` }) }],
      isError: true
    };
  }
  return tool.handler(args || {});
});

// 启动 stdio 传输
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[feishu-mcp] Server started, ${tools.length} tools registered`);
}

main().catch(err => {
  console.error('[feishu-mcp] Fatal error:', err);
  process.exit(1);
});
