/**
 * Feishu Provider — Target Directory (P1 IMTargetDirectory)
 *
 * 列出 bot 可达的 chat (群聊 / 私聊)，供 Agent 主动外发时挑选。
 * 走 GET /open-apis/im/v1/chats（bot 视角的会话列表）。
 */

import type { IMTarget, ListTargetsOptions } from '../../core/types';
import type { FeishuClient } from './client';
import type { FeishuConfig } from './config';

interface FeishuChatRow {
  chat_id: string;
  name?: string;
  description?: string;
  chat_mode?: string;
  chat_type?: string;
}

const PAGE_SIZE_DEFAULT = 50;

export async function listFeishuTargets(
  client: FeishuClient,
  config: FeishuConfig,
  opts: ListTargetsOptions = {},
): Promise<IMTarget[]> {
  const baseUrl = config.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
  const limit = opts.limit ?? PAGE_SIZE_DEFAULT;
  const url = new URL(`${baseUrl}/open-apis/im/v1/chats`);
  url.searchParams.set('page_size', String(Math.min(limit, 100)));
  if (opts.query) url.searchParams.set('query', opts.query);

  const tokenRes = await client.probeCredentials();
  if (!tokenRes.ok) return [];

  // 用 lark Client 走 SDK 拉列表
  const sdkClient = client.ensureRest();
  const response = await sdkClient.im.chat.list({
    params: { page_size: Math.min(limit, 100), sort_type: 'ByActiveTimeDesc' },
  });
  const rows = (response?.data?.items || []) as FeishuChatRow[];
  return rows
    .filter((row) => Boolean(row.chat_id))
    .filter((row) => !opts.kind || mapKind(row) === opts.kind)
    .slice(0, limit)
    .map(toTarget);
}

export async function resolveFeishuTarget(
  client: FeishuClient,
  config: FeishuConfig,
  query: string,
): Promise<IMTarget | null> {
  if (!query.trim()) return null;
  // chat_id 直接命中，否则按 name 过滤
  const targets = await listFeishuTargets(client, config, { query, limit: 50 });
  const lowered = query.toLowerCase();
  const exact = targets.find((t) => t.id === query) || targets.find((t) => t.name === query);
  if (exact) return exact;
  return targets.find((t) => t.name.toLowerCase().includes(lowered)) || null;
}

function toTarget(row: FeishuChatRow): IMTarget {
  return {
    id: row.chat_id,
    name: row.name || row.chat_id,
    kind: mapKind(row),
    description: row.description,
  };
}

function mapKind(row: FeishuChatRow): IMTarget['kind'] {
  if (row.chat_mode === 'p2p' || row.chat_type === 'private') return 'direct';
  return 'group';
}
