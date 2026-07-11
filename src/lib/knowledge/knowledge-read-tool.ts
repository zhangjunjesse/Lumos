import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as store from './store';
import { loadFullItemContent } from './pipeline-support';

const DEFAULT_MAX_CHARS = 24_000;
const MAX_CHARS_LIMIT = 60_000;

export interface KnowledgeItemReadResult {
  success: true;
  kb_uri: string;
  item_id: string;
  title: string;
  source_path: string;
  source_type: string;
  collection_id: string;
  collection_name: string;
  tags: string[];
  summary: string;
  offset: number;
  max_chars: number;
  returned_chars: number;
  total_chars: number;
  has_more: boolean;
  next_offset: number | null;
  content: string;
}

export interface KnowledgeItemReadError {
  success: false;
  error: string;
  kb_uri?: string;
}

type KnowledgeItemReadPayload = KnowledgeItemReadResult | KnowledgeItemReadError;

function jsonResult(payload: KnowledgeItemReadPayload, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
  return Math.min(max, Math.max(min, n));
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function resolveKnowledgeItemId(ref: string): string | null {
  let value = ref.trim();
  if (!value) return null;

  if (value.startsWith('kb://item/')) {
    value = value.slice('kb://item/'.length);
  } else if (value.startsWith('kb:item:')) {
    value = value.slice('kb:item:'.length);
  }

  value = value.split(/[?#]/, 1)[0]?.trim() || '';
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw value if it is not URI-encoded.
  }

  if (!value || value.length > 200 || /[\s"'`<>]/.test(value)) {
    return null;
  }
  return value;
}

export function readKnowledgeItemByRef(input: {
  kbUri: string;
  offset?: number;
  maxChars?: number;
}): KnowledgeItemReadPayload {
  const itemId = resolveKnowledgeItemId(input.kbUri);
  if (!itemId) {
    return {
      success: false,
      kb_uri: input.kbUri,
      error: 'Invalid kb_uri. Expected kb://item/<item_id> or a raw knowledge item id.',
    };
  }

  const item = store.getItem(itemId);
  if (!item) {
    return {
      success: false,
      kb_uri: input.kbUri,
      error: `Knowledge item not found: ${itemId}`,
    };
  }

  const fullContent = loadFullItemContent(item.id, item.content || '');
  if (!fullContent.trim()) {
    return {
      success: false,
      kb_uri: `kb://item/${item.id}`,
      error: 'Knowledge item has no readable text content.',
    };
  }

  const offset = clampInteger(input.offset, 0, 0, fullContent.length);
  const maxChars = clampInteger(input.maxChars, DEFAULT_MAX_CHARS, 1, MAX_CHARS_LIMIT);
  const end = Math.min(fullContent.length, offset + maxChars);
  const content = fullContent.slice(offset, end);
  const collection = store.getCollection(item.collection_id);

  return {
    success: true,
    kb_uri: `kb://item/${item.id}`,
    item_id: item.id,
    title: item.title,
    source_path: item.source_path,
    source_type: item.source_type,
    collection_id: item.collection_id,
    collection_name: collection?.name || '',
    tags: parseJsonArray(item.tags),
    summary: item.summary || '',
    offset,
    max_chars: maxChars,
    returned_chars: content.length,
    total_chars: fullContent.length,
    has_more: end < fullContent.length,
    next_offset: end < fullContent.length ? end : null,
    content,
  };
}

export function createReadKnowledgeItemTool() {
  return tool(
    'read_knowledge_item',
    'Read the full text stored for a Lumos knowledge item by kb_uri. '
      + 'Use this after search_knowledge or after seeing a kb_uri in knowledge context when you need details, quotes, or whole-document synthesis. '
      + 'Large items are returned in pages; if has_more is true, call again with offset=next_offset.',
    {
      kb_uri: z.string().min(1).describe('Knowledge item reference, usually kb://item/<item_id>. A raw item id is also accepted.'),
      offset: z.number().int().min(0).optional().describe('Character offset for paging. Defaults to 0.'),
      max_chars: z.number().int().min(1).max(MAX_CHARS_LIMIT).optional()
        .describe(`Maximum characters to return. Defaults to ${DEFAULT_MAX_CHARS}, max ${MAX_CHARS_LIMIT}.`),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const payload = readKnowledgeItemByRef({
          kbUri: args.kb_uri,
          offset: args.offset,
          maxChars: args.max_chars,
        });
        return jsonResult(payload, payload.success === false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({ success: false, error: message }, true);
      }
    },
  );
}
