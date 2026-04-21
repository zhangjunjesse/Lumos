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
  image_provider?: CloudImageProviderConfig | null;
  /** Per-capability admin toggles. Absent fields are treated as false. */
  allow_custom_providers?: Partial<CustomProviderFlags>;
}

export interface CloudImageProviderModel {
  value: string;
  label: string;
}

export interface CloudImageProviderConfig {
  enabled: boolean;
  name: string;
  provider_type: string;
  api_protocol: string;
  base_url: string;
  api_key: string;
  default_model: string;
  model_catalog: CloudImageProviderModel[];
}
