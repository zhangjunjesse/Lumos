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
