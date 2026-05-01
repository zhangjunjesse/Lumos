import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  listPlugins,
  getPlugin,
  isProviderConfigured,
  isProviderEnabled,
  getDefaultProviderId,
  getOrCreateAdapter,
  hasProvider,
  hasTargetDirectory,
  mimeFromPath,
  resolveLumosSandboxPath,
  sendToProvider,
  sendToDefault,
} from '@/lib/im';
import type { IMFileAttachment } from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/im/tool
 *
 * Single dispatching endpoint used by the im-tools MCP server.
 * Body shape: { action: string, ...args }.
 *
 * 这层故意做"薄"：解析 action，路由到 @/lib/im 的对应函数，错误统一返回。
 * 不在这里做业务逻辑——业务都在 @/lib/im。
 */

interface ToolRequest {
  action?: string;
  providerId?: string;
  chatId?: string;
  text?: string;
  query?: string;
  limit?: number;
  // im_send_attachment / im_send_to_default_attachment
  filePath?: string;
  fileName?: string;
  mimeType?: string;
}

export async function POST(request: NextRequest) {
  let body: ToolRequest;
  try {
    body = (await request.json()) as ToolRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const action = body.action?.trim();
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  try {
    switch (action) {
      case 'im_list_providers':
        return NextResponse.json(listProvidersAction());
      case 'im_default_provider':
        return NextResponse.json({ providerId: getDefaultProviderId() });
      case 'im_list_targets':
        return NextResponse.json(await listTargetsAction(body));
      case 'im_send':
        return NextResponse.json(await sendAction(body));
      case 'im_send_to_default':
        return NextResponse.json(await sendDefaultAction(body));
      case 'im_send_attachment':
        return NextResponse.json(await sendAttachmentAction(body));
      case 'im_send_to_default_attachment':
        return NextResponse.json(await sendToDefaultAttachmentAction(body));
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function listProvidersAction() {
  const defaultId = getDefaultProviderId();
  const providers = listPlugins().map((plugin) => ({
    id: plugin.manifest.id,
    label: plugin.manifest.label,
    capabilities: plugin.manifest.capabilities,
    configured: isProviderConfigured(plugin.manifest.id),
    enabled: isProviderEnabled(plugin.manifest.id),
    isDefault: defaultId === plugin.manifest.id,
  }));
  return { providers, defaultProviderId: defaultId };
}

async function listTargetsAction(body: ToolRequest) {
  const providerId = body.providerId?.trim();
  if (!providerId) throw new Error('providerId required');
  const plugin = getPlugin(providerId);
  if (!plugin) throw new Error(`unknown provider: ${providerId}`);
  if (!plugin.manifest.capabilities.targetDirectory) {
    return { providerId, targets: [], note: `${providerId} does not implement targetDirectory` };
  }
  const adapter = getOrCreateAdapter(providerId);
  if (!hasTargetDirectory(adapter)) {
    return { providerId, targets: [], note: 'adapter has no target directory at runtime' };
  }
  const targets = await adapter.listTargets({ query: body.query, limit: body.limit });
  return { providerId, targets };
}

async function sendAction(body: ToolRequest) {
  const providerId = body.providerId?.trim();
  const chatId = body.chatId?.trim();
  const text = body.text?.trim();
  if (!providerId) throw new Error('providerId required');
  if (!chatId) throw new Error('chatId required');
  if (!text) throw new Error('text required');
  if (!hasProvider(providerId)) throw new Error(`unknown provider: ${providerId}`);
  const result = await sendToProvider(providerId, {
    address: { providerId, chatId },
    text,
  });
  return result;
}

async function sendDefaultAction(body: ToolRequest) {
  const chatId = body.chatId?.trim();
  const text = body.text?.trim();
  if (!chatId) throw new Error('chatId required');
  if (!text) throw new Error('text required');
  const providerId = getDefaultProviderId();
  if (!providerId) {
    return { ok: false, error: 'no default IM provider configured' };
  }
  return sendToDefault({
    address: { providerId, chatId },
    text,
  });
}

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MiB — matches wechat CDN cap

function loadSandboxAttachment(args: {
  filePath: string;
  fileName?: string;
  mimeType?: string;
}): IMFileAttachment {
  const safe = resolveLumosSandboxPath(args.filePath);
  if (!safe) {
    throw new Error(
      `filePath not allowed: must be under ~/.lumos/.lumos-uploads / .lumos-media / .lumos-images (or legacy .codepilot-*)`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(safe);
  } catch (err) {
    throw new Error(`cannot read filePath: ${err instanceof Error ? err.message : err}`);
  }
  if (bytes.length === 0) throw new Error('file is empty');
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`file exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  const baseName = path.basename(safe);
  return {
    id: `tool-${Date.now()}-${baseName}`,
    name: (args.fileName || '').trim() || baseName,
    type: (args.mimeType || '').trim() || mimeFromPath(safe),
    size: bytes.length,
    data: bytes.toString('base64'),
    filePath: safe,
  };
}

async function sendAttachmentAction(body: ToolRequest) {
  const providerId = body.providerId?.trim();
  const chatId = body.chatId?.trim();
  const filePath = body.filePath?.trim();
  const text = body.text?.trim();
  if (!providerId) throw new Error('providerId required');
  if (!chatId) throw new Error('chatId required');
  if (!filePath) throw new Error('filePath required');
  if (!hasProvider(providerId)) throw new Error(`unknown provider: ${providerId}`);

  const attachment = loadSandboxAttachment({
    filePath,
    fileName: body.fileName,
    mimeType: body.mimeType,
  });
  return sendToProvider(providerId, {
    address: { providerId, chatId },
    text: text || '',
    attachments: [attachment],
  });
}

async function sendToDefaultAttachmentAction(body: ToolRequest) {
  const chatId = body.chatId?.trim();
  const filePath = body.filePath?.trim();
  const text = body.text?.trim();
  if (!chatId) throw new Error('chatId required');
  if (!filePath) throw new Error('filePath required');
  const providerId = getDefaultProviderId();
  if (!providerId) {
    return { ok: false, error: 'no default IM provider configured' };
  }
  const attachment = loadSandboxAttachment({
    filePath,
    fileName: body.fileName,
    mimeType: body.mimeType,
  });
  return sendToDefault({
    address: { providerId, chatId },
    text: text || '',
    attachments: [attachment],
  });
}
