import { getFeishuCredentials } from '@/lib/feishu-config';
import { handleFeishuMessage } from '@/lib/bridge/message-handler';
import { upsertBridgeConnection } from '@/lib/bridge/storage/bridge-connection-repo';
import { WebSocketManager } from './websocket-manager';

let ensureStartPromise: Promise<void> | null = null;

export async function ensureFeishuWebSocketStarted(): Promise<void> {
  const manager = WebSocketManager.getInstance();
  if (manager.isRunning()) return;
  if (ensureStartPromise) return ensureStartPromise;

  const { appId, appSecret } = getFeishuCredentials();
  if (!appId || !appSecret) {
    throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  }

  ensureStartPromise = manager
    .start({
      appId,
      appSecret,
      onMessage: async (data) => {
        await handleFeishuMessage(data as Parameters<typeof handleFeishuMessage>[0]);
      },
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start listener';
      upsertBridgeConnection({
        platform: 'feishu',
        accountId: 'default',
        transportKind: 'websocket',
        status: 'disconnected',
        lastErrorAt: Date.now(),
        lastErrorMessage: errorMessage,
      });
      throw error;
    })
    .finally(() => {
      ensureStartPromise = null;
    });

  return ensureStartPromise;
}

export function stopFeishuWebSocket(): void {
  const manager = WebSocketManager.getInstance();
  if (!manager.isRunning()) return;
  manager.stop();
}
