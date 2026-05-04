/**
 * IM Config Store
 *
 * 唯一的 IM 配置读写入口。所有 provider/UI/API 都过这里，
 * 不允许直接调 setSetting('im.foo.bar') 或 getSetting('feishu_app_id')。
 *
 * Settings 命名空间：
 *   im.<provider>.<field>   单个 provider 的配置字段
 *   im.enabled              JSON array<provider id>，启用列表
 *   im.default              默认 provider id（字符串）
 *   im.migration.<version>  迁移记录，防重复
 */

import { getSetting, setSetting } from '@/lib/db';
import type { IMProviderId } from './types';
import { getPlugin } from './registry';

const NS = 'im';
const KEY_ENABLED = `${NS}.enabled`;
const KEY_DEFAULT = `${NS}.default`;
const KEY_MIGRATION_PREFIX = `${NS}.migration.`;

// ----------------------------------------------------------------------------
// 单字段读写
// ----------------------------------------------------------------------------

function fieldKey(providerId: IMProviderId, field: string): string {
  return `${NS}.${providerId}.${field}`;
}

export function getProviderField(providerId: IMProviderId, field: string): string {
  return getSetting(fieldKey(providerId, field)) ?? '';
}

export function setProviderField(providerId: IMProviderId, field: string, value: string): void {
  setSetting(fieldKey(providerId, field), value);
}

// ----------------------------------------------------------------------------
// 整 provider 配置读写（按 manifest.configSchema）
// ----------------------------------------------------------------------------

export function getProviderConfig(providerId: IMProviderId): Record<string, string> {
  const plugin = getPlugin(providerId);
  if (!plugin) return {};
  const config: Record<string, string> = {};
  for (const field of plugin.manifest.configSchema) {
    const v = getProviderField(providerId, field.key);
    if (v) config[field.key] = v;
    else if (field.default !== undefined) config[field.key] = String(field.default);
  }
  return config;
}

export function setProviderConfig(
  providerId: IMProviderId,
  patch: Record<string, string>,
  opts: { allowSecretMaskPassthrough?: boolean } = {},
): void {
  const plugin = getPlugin(providerId);
  if (!plugin) throw new Error(`[im/config] unknown provider: ${providerId}`);

  const validKeys = new Set(plugin.manifest.configSchema.map((f) => f.key));
  for (const [k, v] of Object.entries(patch)) {
    if (!validKeys.has(k)) continue; // 静默忽略未声明字段，避免 schema 漂移把脏数据写入
    const field = plugin.manifest.configSchema.find((f) => f.key === k)!;
    const trimmed = (v ?? '').trim();
    // secret 字段：UI 通常会把当前值 mask 成 ***xxx 回传；遇到这种保留旧值。
    if (field.type === 'secret' && opts.allowSecretMaskPassthrough && trimmed.startsWith('***')) {
      continue;
    }
    setProviderField(providerId, k, trimmed);
  }
}

export function isProviderConfigured(providerId: IMProviderId): boolean {
  const plugin = getPlugin(providerId);
  if (!plugin) return false;
  const config = getProviderConfig(providerId);
  return plugin.manifest.configSchema
    .filter((f) => f.required)
    .every((f) => Boolean(config[f.key]));
}

// ----------------------------------------------------------------------------
// 启用列表
// ----------------------------------------------------------------------------

export function getEnabledProviders(): IMProviderId[] {
  const raw = getSetting(KEY_ENABLED);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setProviderEnabled(providerId: IMProviderId, enabled: boolean): void {
  const set = new Set(getEnabledProviders());
  if (enabled) set.add(providerId);
  else set.delete(providerId);
  setSetting(KEY_ENABLED, JSON.stringify(Array.from(set)));
}

export function isProviderEnabled(providerId: IMProviderId): boolean {
  return getEnabledProviders().includes(providerId);
}

// ----------------------------------------------------------------------------
// 默认 IM
// ----------------------------------------------------------------------------

export function getDefaultProviderId(): IMProviderId | null {
  const v = getSetting(KEY_DEFAULT);
  return v && v.trim() ? v.trim() : null;
}

export function setDefaultProviderId(providerId: IMProviderId | null): void {
  setSetting(KEY_DEFAULT, providerId ?? '');
}

// ----------------------------------------------------------------------------
// 迁移记录（防重复执行）
// ----------------------------------------------------------------------------

export function isMigrationApplied(version: string): boolean {
  return getSetting(`${KEY_MIGRATION_PREFIX}${version}`) === '1';
}

export function markMigrationApplied(version: string): void {
  setSetting(`${KEY_MIGRATION_PREFIX}${version}`, '1');
}
