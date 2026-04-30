/**
 * IM Adapter Runtime
 *
 * 运行态：维护"当前在跑哪些 adapter"，并提供出站发送的统一入口。
 * 不持久化任何状态——重启后从 config-store 重建。
 *
 * 设计意图：让 lumos 任何代码（workflow、agent 工具、API 路由）
 * 通过 sendToProvider / sendToDefault 单一入口发消息，不关心具体 IM。
 */

import type { IMAdapter, IMProviderId, OutboundMessage, SendResult } from './types';
import { getPlugin, listProviderIds } from './registry';
import {
  getProviderConfig,
  isProviderConfigured,
  isProviderEnabled,
  getDefaultProviderId,
} from './config-store';

const adapters = new Map<IMProviderId, IMAdapter>();

// ----------------------------------------------------------------------------
// 实例化 / 生命周期
// ----------------------------------------------------------------------------

export function getOrCreateAdapter(providerId: IMProviderId): IMAdapter {
  const cached = adapters.get(providerId);
  if (cached) return cached;

  const plugin = getPlugin(providerId);
  if (!plugin) throw new Error(`[im/runtime] unknown provider: ${providerId}`);

  const config = getProviderConfig(providerId);
  const adapter = plugin.createAdapter(config);
  adapters.set(providerId, adapter);
  return adapter;
}

export async function startAdapter(providerId: IMProviderId): Promise<void> {
  const adapter = getOrCreateAdapter(providerId);
  if (adapter.isRunning()) return;
  await adapter.start();
}

export async function stopAdapter(providerId: IMProviderId): Promise<void> {
  const adapter = adapters.get(providerId);
  if (!adapter) return;
  if (adapter.isRunning()) await adapter.stop();
  adapters.delete(providerId);
}

export async function restartAdapter(providerId: IMProviderId): Promise<void> {
  await stopAdapter(providerId);
  await startAdapter(providerId);
}

export function getActiveAdapter(providerId: IMProviderId): IMAdapter | null {
  const adapter = adapters.get(providerId);
  return adapter && adapter.isRunning() ? adapter : null;
}

export function listActiveAdapters(): IMAdapter[] {
  return Array.from(adapters.values()).filter((a) => a.isRunning());
}

// ----------------------------------------------------------------------------
// 批量启停（供 electron bootstrap / 应用关闭使用）
// ----------------------------------------------------------------------------

export async function startAllEnabled(): Promise<void> {
  const ids = listProviderIds().filter(
    (id) => isProviderEnabled(id) && isProviderConfigured(id),
  );
  await Promise.all(ids.map((id) => startAdapter(id).catch(logStartError(id))));
}

export async function stopAll(): Promise<void> {
  await Promise.all(Array.from(adapters.keys()).map((id) => stopAdapter(id)));
}

function logStartError(id: IMProviderId) {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[im/runtime] failed to start ${id}: ${msg}`);
  };
}

// ----------------------------------------------------------------------------
// 出站发送
// ----------------------------------------------------------------------------

export async function sendToProvider(
  providerId: IMProviderId,
  message: OutboundMessage,
): Promise<SendResult> {
  await startAdapter(providerId);
  const adapter = getActiveAdapter(providerId);
  if (!adapter) return { ok: false, error: `provider not active: ${providerId}` };
  return adapter.send(message);
}

export async function sendToDefault(message: OutboundMessage): Promise<SendResult> {
  const defaultId = getDefaultProviderId();
  if (!defaultId) return { ok: false, error: 'no default IM provider configured' };
  if (message.address.providerId !== defaultId) {
    // 调用方必须把 address.providerId 设成 default；这里防御一下
    return {
      ok: false,
      error: `address.providerId (${message.address.providerId}) does not match default (${defaultId})`,
    };
  }
  return sendToProvider(defaultId, message);
}

/**
 * 仅供测试：清空所有缓存的 adapter（不调 stop）。生产代码不要调。
 */
export function __resetRuntimeForTesting(): void {
  adapters.clear();
}
