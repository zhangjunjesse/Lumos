/**
 * Lumos Cloud 相关公共类型。
 */
import type { CustomProviderFlags } from '@/lib/auth/custom-provider-capabilities';

export interface CloudUserInfo {
  id: string;
  email: string;
  nickname: string;
  role: string;
  membership: string;
  status: string;
  newapi_token_key: string | null;
  /**
   * Admin 下发的图片服务商列表。每条都已通过服务端过滤 (enabled + api_key 非空)，
   * 桌面端按 `id` (remote) 做一对一 upsert 本地 provider。
   */
  image_providers?: CloudImageProviderConfig[];
  /**
   * Admin 下发的对话服务商列表（虚拟服务商）。`api_key` 由 lumos-web 在请求时
   * 注入为当前用户的 `sk-<newapi_token_key>`，因此下游 new-api 按本用户计费。
   * 桌面端按 `id` (remote) 做一对一 upsert 本地 provider。
   */
  chat_providers?: CloudChatProviderConfig[];
  /** Per-capability admin toggles. Absent fields are treated as false. */
  allow_custom_providers?: Partial<CustomProviderFlags>;
}

export interface CloudImageProviderModel {
  value: string;
  label: string;
}

export interface CloudImageProviderConfig {
  /** Remote provider id from lumos-web (stable identity across renames). */
  id: string;
  /** Whether this is the admin-designated system default. Only 0 或 1 条会为 true。 */
  is_default: boolean;
  name: string;
  provider_type: string;
  api_protocol: string;
  base_url: string;
  api_key: string;
  default_model: string;
  model_catalog: CloudImageProviderModel[];
}

export interface CloudChatProviderModel {
  value: string;
  label: string;
  /** 每 1,000,000 输入 token 的额度单位（500000 = ¥1）。仅用于展示。 */
  input_price_per_mtok: number;
  /** 每 1,000,000 输出 token 的额度单位（500000 = ¥1）。仅用于展示。 */
  output_price_per_mtok: number;
}

export interface CloudChatProviderConfig {
  /** Remote provider id from lumos-web (stable identity across renames). */
  id: string;
  is_default: boolean;
  name: string;
  provider_type: string;
  api_protocol: string;
  base_url: string;
  /** 每次请求传给 new-api 的 sk-…，来自当前登录用户的 newapi_token_key。 */
  api_key: string;
  /**
   * 对应 new-api 的 channel id。桌面端请求时会同时补 admin-token `-channelId`
   * 后缀，并保留 `Specific-Channel-Id` 兼容头，确保 new-api 精确路由到该
   * channel，避免与其他共享同 model 的 channel 按 priority/weight 漂移。
   * null 表示历史遗留、尚未建立 channel 的 provider。
   */
  newapi_channel_id: number | null;
  default_model: string;
  model_catalog: CloudChatProviderModel[];
}
