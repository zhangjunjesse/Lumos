/**
 * IM Plugin Registry — Static
 *
 * 维护"哪些 IM 在编译期被注册了"。每个 provider 通过
 * src/lib/im/index.ts 顶层调用 registerPlugin 注册自己。
 *
 * 不做：
 *  - 不动态扫描目录
 *  - 不持有 adapter 实例（运行态由 runtime.ts 管）
 *  - 不读 settings（启用/默认状态由 config-store.ts 管）
 */

import type { IMPlugin, IMProviderId } from './types';

const plugins = new Map<IMProviderId, IMPlugin>();

export function registerPlugin(plugin: IMPlugin): void {
  if (plugins.has(plugin.manifest.id)) {
    throw new Error(`[im/registry] duplicate plugin id: ${plugin.manifest.id}`);
  }
  plugins.set(plugin.manifest.id, plugin);
}

export function getPlugin(id: IMProviderId): IMPlugin | null {
  return plugins.get(id) ?? null;
}

export function listPlugins(): IMPlugin[] {
  return Array.from(plugins.values());
}

export function listProviderIds(): IMProviderId[] {
  return Array.from(plugins.keys());
}

export function hasProvider(id: IMProviderId): boolean {
  return plugins.has(id);
}

/**
 * 仅供测试 / 热重载。生产代码不要调。
 */
export function __resetRegistryForTesting(): void {
  plugins.clear();
}
