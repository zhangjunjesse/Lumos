/**
 * Feishu Provider — Streaming Preview (IMStreamingPreview)
 *
 * 在飞书聊天里以"互动卡片"的形式实时刷新 AI 输出，呈现打字效果。
 * 算法：
 *   - startPreview 发送一张占位卡片，得到 message_id
 *   - updatePreview 用 PATCH /im/v1/messages/{id} 刷新卡片内容（带 debounce）
 *   - finalizePreview 强制 flush 最终内容并清空 status
 *
 * 卡片渲染逻辑（buildInteractiveCard / trimFeishuCardContent）从原
 * src/lib/bridge/sync-helper.ts 搬迁过来，使本 provider 自包含（R1 垂直切片）。
 *
 * REST 调用复用 src/lib/bridge/adapters/feishu-api.ts 的 FeishuAPI 类——
 * 那是 feishu 通用 REST 工具，与 IM 桥接耦合度低。
 */

import { FeishuAPI, type FeishuInteractiveCardContent } from '../../../bridge/adapters/feishu-api';
import type {
  ChannelAddress,
  IMStreamingPreview,
  PreviewHandle,
} from '../../core/types';
import type { FeishuConfig } from './config';

const FEISHU_CARD_MAX_CONTENT_LENGTH = 8_000;
const FEISHU_CARD_UPDATE_INTERVAL_MS = 700;

interface CardWriterState {
  api: FeishuAPI;
  messageId: string;
  latestContent: string;
  latestStatus: string;
  lastRenderedKey: string;
  lastFlushAt: number;
  flushTimer: NodeJS.Timeout | null;
  flushChain: Promise<void>;
  broken: boolean;
}

const writers = new Map<string, CardWriterState>();

function makeCardId(messageId: string): string {
  return `feishu-card-${messageId}`;
}

export class FeishuStreamingPreview implements IMStreamingPreview {
  constructor(private readonly config: FeishuConfig) {}

  async startPreview(address: ChannelAddress, initialText?: string): Promise<PreviewHandle> {
    const api = new FeishuAPI(this.config.appId, this.config.appSecret);
    const card = buildInteractiveCard({
      role: 'assistant',
      content: initialText || '',
      statusText: '正在思考...',
    });

    const sent = await api.sendInteractiveMessage(address.chatId, card);
    if (!sent.message_id) throw new Error('failed to send initial preview card');

    const cardId = makeCardId(sent.message_id);
    writers.set(cardId, {
      api,
      messageId: sent.message_id,
      latestContent: initialText || '',
      latestStatus: '正在思考...',
      lastRenderedKey: '',
      lastFlushAt: 0,
      flushTimer: null,
      flushChain: Promise.resolve(),
      broken: false,
    });

    return { providerId: 'feishu', cardId, address };
  }

  async updatePreview(handle: PreviewHandle, chunk: string): Promise<void> {
    const state = writers.get(handle.cardId);
    if (!state || state.broken) return;
    state.latestContent = chunk;
    state.latestStatus = '实时生成中...';
    scheduleFlush(state);
  }

  async finalizePreview(handle: PreviewHandle, finalText: string): Promise<void> {
    const state = writers.get(handle.cardId);
    if (!state) return;
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    state.latestContent = finalText;
    state.latestStatus = '';
    await flush(state, true);
    writers.delete(handle.cardId);
  }
}

// ---- Debounced flush ---------------------------------------------------------

function scheduleFlush(state: CardWriterState): void {
  if (state.flushTimer) return;
  const elapsed = Date.now() - state.lastFlushAt;
  const delay = elapsed >= FEISHU_CARD_UPDATE_INTERVAL_MS
    ? 0
    : FEISHU_CARD_UPDATE_INTERVAL_MS - elapsed;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void flush(state, false);
  }, delay);
}

async function flush(state: CardWriterState, force: boolean): Promise<void> {
  if (state.broken) return;
  const card = buildInteractiveCard({
    role: 'assistant',
    content: state.latestContent,
    statusText: state.latestStatus || undefined,
  });
  const renderKey = JSON.stringify(card);
  if (!force && renderKey === state.lastRenderedKey) return;

  state.flushChain = state.flushChain
    .catch(() => undefined)
    .then(async () => {
      try {
        await state.api.updateInteractiveMessage(state.messageId, card);
        state.lastRenderedKey = renderKey;
        state.lastFlushAt = Date.now();
      } catch (error) {
        state.broken = true;
        console.warn('[feishu/streaming-preview] update failed:', error);
      }
    });
  await state.flushChain;
}

// ---- Card 渲染（从 bridge/sync-helper 搬迁，self-contained） -------------------

interface BuildCardParams {
  role: 'user' | 'assistant';
  content: string;
  statusText?: string;
}

function buildInteractiveCard(params: BuildCardParams): FeishuInteractiveCardContent {
  const { role, statusText } = params;
  const { text, truncated } = trimContent(params.content);
  const bodyParts: string[] = [];
  if (statusText?.trim()) bodyParts.push(`> ${statusText.trim()}`);
  if (text) bodyParts.push(text);
  else if (statusText?.trim()) bodyParts.push('_等待输出内容..._');
  if (truncated) bodyParts.push('_内容过长，已截断，请回到 Lumos 查看完整回复。_');

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: role === 'user' ? '👤 用户' : '🤖 AI' },
      template: role === 'user' ? 'blue' : 'green',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: bodyParts.join('\n\n') || '_暂无内容_' },
      },
    ],
  };
}

function trimContent(content: string): { text: string; truncated: boolean } {
  const normalized = (content || '').trim();
  if (normalized.length <= FEISHU_CARD_MAX_CONTENT_LENGTH) {
    return { text: normalized, truncated: false };
  }
  return {
    text: normalized.slice(0, FEISHU_CARD_MAX_CONTENT_LENGTH).trimEnd(),
    truncated: true,
  };
}

export function __resetStreamingPreviewForTesting(): void {
  for (const state of writers.values()) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
  }
  writers.clear();
}
