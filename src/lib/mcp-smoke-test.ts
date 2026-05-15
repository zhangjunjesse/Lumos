import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import os from 'os';
import path from 'path';
import type { MCPServerConfig } from '@/types';
import { dataDir } from '@/lib/db/connection';
import { getVenvPythonPath, isVenvReady } from '@/lib/python-venv';
import { resolvePythonBinary } from '@/lib/python-runtime';
import { resolveRuntimeResourceRootFor } from '@/lib/runtime-resources';
import { resolveMcpConfigPlaceholders } from '@/lib/mcp-config-placeholders';
import { resolveMcpRuntimeCommand } from '@/lib/mcp-runtime-command';

const REQUEST_TIMEOUT_MS = 8000;
const STREAMABLE_HTTP_PROTOCOL_VERSION = '2025-03-26';
const LEGACY_SSE_PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcMessage {
  id?: string | number | null;
  result?: unknown;
  error?: { message?: string };
}

interface SseEvent {
  event?: string;
  data: string;
}

interface SseReadState {
  decoder: TextDecoder;
  buffer: string;
  bytesRead: number;
  pendingEvents: SseEvent[];
}

export interface McpSmokeTestResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  tools?: string[];
  transport?: 'stdio' | 'sse' | 'http';
}

function resolveRuntimePath(): string {
  return resolveRuntimeResourceRootFor('mcp-servers')
    || resolveRuntimeResourceRootFor('feishu-mcp-server')
    || path.join(process.cwd(), 'resources');
}

function resolvePythonPath(): string {
  return isVenvReady()
    ? getVenvPythonPath()
    : (resolvePythonBinary() || getVenvPythonPath());
}

function resolvePlaceholders(value: string): string {
  return resolveMcpConfigPlaceholders(value, {
    runtimePath: resolveRuntimePath(),
    workspacePath: process.cwd(),
    dataDir,
    pythonPath: resolvePythonPath(),
    userHome: os.homedir(),
  });
}

function makeInitializeRequest(id: number, protocolVersion: string) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'lumos-mcp-smoke-test', version: '1.0.0' },
    },
  };
}

function makeNotification(method: string) {
  return {
    jsonrpc: '2.0',
    method,
    params: {},
  };
}

function makeRequest(id: number, method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

function getProtocolVersion(message: JsonRpcMessage, fallback: string): string {
  const result = message.result;
  if (!result || typeof result !== 'object') return fallback;
  const protocolVersion = (result as { protocolVersion?: unknown }).protocolVersion;
  return typeof protocolVersion === 'string' && protocolVersion ? protocolVersion : fallback;
}

function getToolNames(message: JsonRpcMessage): string[] {
  const tools = (message.result as { tools?: Array<{ name?: unknown }> } | undefined)?.tools || [];
  return tools.map((tool) => String(tool.name || '')).filter(Boolean);
}

function assertJsonRpcSuccess(message: JsonRpcMessage, method: string): void {
  if (message.error) {
    throw new Error(message.error.message || `${method} failed`);
  }
  if (!('result' in message)) {
    throw new Error(`${method} did not return a JSON-RPC result`);
  }
}

function findJsonRpcResponse(value: unknown, expectedId: number): JsonRpcMessage | undefined {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (item && typeof item === 'object' && (item as JsonRpcMessage).id === expectedId) {
      return item as JsonRpcMessage;
    }
  }
  return undefined;
}

async function readWithTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`MCP remote response timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithTimeout(url: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function makeRemoteHeaders(
  server: MCPServerConfig,
  extra: Record<string, string>,
): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(server.headers || {})) {
    headers.set(key, String(value));
  }
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return headers;
}

async function readErrorSnippet(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text ? `: ${text.slice(0, 500)}` : '';
}

function parseSseEvent(raw: string): SseEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  if (!event && data.length === 0) return undefined;
  return { event, data: data.join('\n') };
}

function extractCompleteSseEvents(state: SseReadState): SseEvent[] {
  const events: SseEvent[] = [];
  let separatorIndex = state.buffer.search(/\n\n|\r\n\r\n/);
  while (separatorIndex >= 0) {
    const raw = state.buffer.slice(0, separatorIndex);
    const separatorLength = state.buffer.slice(separatorIndex).startsWith('\r\n\r\n') ? 4 : 2;
    state.buffer = state.buffer.slice(separatorIndex + separatorLength);
    const event = parseSseEvent(raw);
    if (event) events.push(event);
    separatorIndex = state.buffer.search(/\n\n|\r\n\r\n/);
  }
  return events;
}

function queueCompleteSseEvents(state: SseReadState): void {
  state.pendingEvents.push(...extractCompleteSseEvents(state));
}

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: SseReadState,
  predicate: (event: SseEvent) => boolean,
): Promise<SseEvent> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    queueCompleteSseEvents(state);
    let event: SseEvent | undefined;
    while ((event = state.pendingEvents.shift())) {
      if (predicate(event)) return event;
    }

    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await readWithTimeout(reader.read(), remaining, () => {
      reader.cancel().catch(() => undefined);
    });
    if (chunk.done) break;
    state.bytesRead += chunk.value.byteLength;
    if (state.bytesRead > 256 * 1024) {
      throw new Error('MCP SSE response exceeded 256KB during smoke test');
    }
    state.buffer += state.decoder.decode(chunk.value, { stream: true });
  }
  throw new Error(`MCP SSE response timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
}

async function readSseJsonRpcMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: SseReadState,
  expectedId: number,
): Promise<JsonRpcMessage> {
  const event = await readSseEvent(reader, state, (candidate) => {
    if (!candidate.data) return false;
    try {
      return Boolean(findJsonRpcResponse(JSON.parse(candidate.data), expectedId));
    } catch {
      return false;
    }
  });
  const message = findJsonRpcResponse(JSON.parse(event.data), expectedId);
  if (!message) {
    throw new Error(`MCP SSE response did not include JSON-RPC id ${expectedId}`);
  }
  return message;
}

async function readJsonRpcMessageFromHttpResponse(response: Response, expectedId: number): Promise<JsonRpcMessage> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    if (!response.body) {
      throw new Error('MCP HTTP response did not include an event stream body');
    }
    const reader = response.body.getReader();
    try {
      return await readSseJsonRpcMessage(reader, {
        decoder: new TextDecoder(),
        buffer: '',
        bytesRead: 0,
        pendingEvents: [],
      }, expectedId);
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  const text = await readWithTimeout(response.text(), REQUEST_TIMEOUT_MS);
  if (!text.trim()) {
    throw new Error(`MCP HTTP response for id ${expectedId} was empty`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`MCP HTTP response was not valid JSON: ${text.slice(0, 200)}`);
  }
  const message = findJsonRpcResponse(parsed, expectedId);
  if (!message) {
    throw new Error(`MCP HTTP response did not include JSON-RPC id ${expectedId}`);
  }
  return message;
}

async function postStreamableHttpMessage(
  server: MCPServerConfig,
  message: Record<string, unknown>,
  options: { expectedId?: number; sessionId?: string; protocolVersion?: string } = {},
): Promise<{ message?: JsonRpcMessage; sessionId?: string }> {
  const headers = makeRemoteHeaders(server, {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {}),
    ...(options.protocolVersion ? { 'mcp-protocol-version': options.protocolVersion } : {}),
  });
  const response = await fetchWithTimeout(server.url || '', {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const sessionId = response.headers.get('mcp-session-id') || options.sessionId;
  if (!response.ok) {
    throw new Error(`Remote MCP endpoint returned HTTP ${response.status}${await readErrorSnippet(response)}`);
  }
  if (response.status === 202 || options.expectedId === undefined) {
    await response.body?.cancel();
    return { sessionId };
  }
  return {
    sessionId,
    message: await readJsonRpcMessageFromHttpResponse(response, options.expectedId),
  };
}

export function normalizeMcpServerForSmokeTest(raw: unknown): MCPServerConfig {
  const source = raw && typeof raw === 'object' ? raw as Partial<MCPServerConfig> : {};
  const env = source.env && typeof source.env === 'object'
    ? Object.fromEntries(Object.entries(source.env).map(([key, value]) => [key, resolvePlaceholders(String(value ?? ''))]))
    : {};

  const config: MCPServerConfig = {
    command: resolvePlaceholders(String(source.command || '')),
    args: Array.isArray(source.args) ? source.args.map((arg) => resolvePlaceholders(String(arg))) : [],
    env,
    type: source.type || 'stdio',
    runMode: source.runMode || 'on_demand',
    runtime: source.runtime || 'auto',
    url: source.url ? resolvePlaceholders(String(source.url)) : undefined,
    headers: source.headers || {},
    description: source.description,
  };
  config.command = resolveMcpRuntimeCommand(config);
  return config;
}

function readResponse(
  proc: ChildProcessWithoutNullStreams,
  expectedId: number,
  stderrRef: { current: string },
): Promise<JsonRpcMessage> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`MCP test timed out after ${REQUEST_TIMEOUT_MS / 1000}s${stderrRef.current ? `: ${stderrRef.current.slice(-600)}` : ''}`));
    }, REQUEST_TIMEOUT_MS);

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onError);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (msg.id === expectedId) {
            cleanup();
            resolve(msg);
            return;
          }
        } catch {
          // Non-JSON stdout is ignored; timeout/error will include stderr context.
        }
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      cleanup();
      reject(new Error(`MCP server exited during test (${code ?? signal ?? 'unknown'})${stderrRef.current ? `: ${stderrRef.current.slice(-600)}` : ''}`));
    };

    const onError = (error: NodeJS.ErrnoException) => {
      if (settled) return;
      cleanup();
      if (error.code === 'ENOENT') {
        reject(new Error(`Command not found: ${proc.spawnfile || 'unknown command'}. Check whether the runtime is installed or split command and args correctly.`));
        return;
      }
      reject(error);
    };

    proc.stdout.on('data', onData);
    proc.once('exit', onExit);
    proc.once('error', onError);
  });
}

async function sendRequest(
  proc: ChildProcessWithoutNullStreams,
  id: number,
  method: string,
  stderrRef: { current: string },
  params: Record<string, unknown> = {},
): Promise<JsonRpcMessage> {
  const responsePromise = readResponse(proc, id, stderrRef);
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const response = await responsePromise;
  if (response.error) {
    throw new Error(response.error.message || `${method} failed`);
  }
  return response;
}

async function testStdioServer(server: MCPServerConfig): Promise<McpSmokeTestResult> {
  if (!server.command) {
    throw new Error('Missing command for stdio MCP server');
  }

  const stderrRef = { current: '' };
  const proc = spawn(server.command, server.args || [], {
    cwd: dataDir,
    env: {
      ...process.env,
      ...(server.env || {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  proc.stderr.on('data', (chunk: Buffer) => {
    stderrRef.current += chunk.toString('utf-8');
    if (stderrRef.current.length > 4000) {
      stderrRef.current = stderrRef.current.slice(-4000);
    }
  });

  try {
    await sendRequest(proc, 1, 'initialize', stderrRef, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lumos-mcp-smoke-test', version: '1.0.0' },
    });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const toolsResponse = await sendRequest(proc, 2, 'tools/list', stderrRef, {});
    const tools = (toolsResponse.result as { tools?: Array<{ name?: unknown }> } | undefined)?.tools || [];
    return {
      ok: true,
      transport: 'stdio',
      tools: tools.map((tool) => String(tool.name || '')).filter(Boolean),
    };
  } finally {
    proc.kill();
  }
}

async function testStreamableHttpServer(server: MCPServerConfig): Promise<McpSmokeTestResult> {
  if (!server.url) {
    throw new Error('Missing url for http MCP server');
  }

  const initialize = await postStreamableHttpMessage(
    server,
    makeInitializeRequest(1, STREAMABLE_HTTP_PROTOCOL_VERSION),
    { expectedId: 1 },
  );
  const initializeMessage = initialize.message;
  if (!initializeMessage) {
    throw new Error('Remote MCP initialize did not return a JSON-RPC response');
  }
  assertJsonRpcSuccess(initializeMessage, 'initialize');
  const protocolVersion = getProtocolVersion(initializeMessage, STREAMABLE_HTTP_PROTOCOL_VERSION);
  const sessionId = initialize.sessionId;

  await postStreamableHttpMessage(
    server,
    makeNotification('notifications/initialized'),
    { sessionId, protocolVersion },
  );

  const toolsResponse = await postStreamableHttpMessage(
    server,
    makeRequest(2, 'tools/list'),
    { expectedId: 2, sessionId, protocolVersion },
  );
  const toolsMessage = toolsResponse.message;
  if (!toolsMessage) {
    throw new Error('Remote MCP tools/list did not return a JSON-RPC response');
  }
  assertJsonRpcSuccess(toolsMessage, 'tools/list');

  return {
    ok: true,
    transport: 'http',
    tools: getToolNames(toolsMessage),
    reason: 'MCP protocol check passed: initialize and tools/list completed.',
  };
}

async function postLegacySseMessage(
  server: MCPServerConfig,
  endpoint: URL,
  message: Record<string, unknown>,
  protocolVersion?: string,
): Promise<void> {
  const headers = makeRemoteHeaders(server, {
    'content-type': 'application/json',
    ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
  });
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error(`Remote MCP SSE message endpoint returned HTTP ${response.status}${await readErrorSnippet(response)}`);
  }
  await response.body?.cancel();
}

async function testLegacySseServer(server: MCPServerConfig): Promise<McpSmokeTestResult> {
  if (!server.url) {
    throw new Error('Missing url for sse MCP server');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(server.url, {
      method: 'GET',
      headers: {
        ...(server.headers || {}),
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`Remote MCP SSE endpoint returned HTTP ${response.status}${await readErrorSnippet(response)}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error(`Remote MCP SSE endpoint returned unexpected content type: ${contentType || 'unknown'}`);
    }
    if (!response.body) {
      throw new Error('Remote MCP SSE endpoint did not include a response body');
    }

    const reader = response.body.getReader();
    const state: SseReadState = {
      decoder: new TextDecoder(),
      buffer: '',
      bytesRead: 0,
      pendingEvents: [],
    };

    try {
      const endpointEvent = await readSseEvent(reader, state, (event) => event.event === 'endpoint' && Boolean(event.data));
      const endpoint = new URL(endpointEvent.data, server.url);
      const base = new URL(server.url);
      if (endpoint.origin !== base.origin) {
        throw new Error(`Remote MCP SSE endpoint origin mismatch: ${endpoint.origin}`);
      }

      await postLegacySseMessage(
        server,
        endpoint,
        makeInitializeRequest(1, LEGACY_SSE_PROTOCOL_VERSION),
      );
      const initializeMessage = await readSseJsonRpcMessage(reader, state, 1);
      assertJsonRpcSuccess(initializeMessage, 'initialize');
      const protocolVersion = getProtocolVersion(initializeMessage, LEGACY_SSE_PROTOCOL_VERSION);

      await postLegacySseMessage(
        server,
        endpoint,
        makeNotification('notifications/initialized'),
        protocolVersion,
      );
      await postLegacySseMessage(
        server,
        endpoint,
        makeRequest(2, 'tools/list'),
        protocolVersion,
      );
      const toolsMessage = await readSseJsonRpcMessage(reader, state, 2);
      assertJsonRpcSuccess(toolsMessage, 'tools/list');

      return {
        ok: true,
        transport: 'sse',
        tools: getToolNames(toolsMessage),
        reason: 'MCP protocol check passed: SSE endpoint, initialize and tools/list completed.',
      };
    } finally {
      reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function testRemoteServer(server: MCPServerConfig): Promise<McpSmokeTestResult> {
  try {
    if (server.type === 'sse') {
      return await testLegacySseServer(server);
    }
    return await testStreamableHttpServer(server);
  } catch (error) {
    return {
      ok: false,
      transport: server.type === 'sse' ? 'sse' : 'http',
      error: error instanceof Error ? error.message : 'Remote MCP protocol check failed',
    };
  }
}

export async function smokeTestMcpServerConfig(rawServer: unknown): Promise<McpSmokeTestResult> {
  try {
    const server = normalizeMcpServerForSmokeTest(rawServer);
    if (server.type === 'sse' || server.type === 'http') {
      return await testRemoteServer(server);
    }
    return await testStdioServer(server);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'MCP smoke test failed',
    };
  }
}
