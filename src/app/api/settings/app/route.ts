import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import {
  ProviderResolutionError,
  resolveProviderForCapability,
  type ProviderModuleKey,
} from '@/lib/provider-resolver';
import type { ProviderCapability } from '@/types';

/**
 * Lumos app-level settings (stored in SQLite, separate from ~/.claude/settings.json).
 * Legacy anthropic_* keys remain here only for one-time migration compatibility.
 */

const ALLOWED_KEYS = [
  'anthropic_auth_token',
  'anthropic_base_url',
  'dangerously_skip_permissions',
  'kb_context_enabled',
  'kb_retrieval_mode',
  'kb_context_top_k',
  'kb_candidate_pool_size',
  'kb_query_rewrite_enabled',
  'kb_query_rewrite_model',
  'memory_system_enabled',
  'memory_context_max_items',
  'memory_intelligence_enabled',
  'memory_intelligence_provider_id',
  'memory_intelligence_should_model',
  'memory_intelligence_extract_model',
  'memory_intelligence_should_prompt',
  'memory_intelligence_extract_prompt',
  'memory_intelligence_confidence_threshold',
  'memory_intelligence_cooldown_seconds',
  'memory_intelligence_daily_budget',
  'memory_intelligence_max_items_per_run',
  'memory_intelligence_window_messages',
  'memory_intelligence_trigger_session_switch_enabled',
  'memory_intelligence_trigger_idle_enabled',
  'memory_intelligence_trigger_weak_signal_enabled',
  'memory_intelligence_idle_timeout_ms',
  'memory_intelligence_last_run_at',
  'provider_override:knowledge',
  'provider_override:workflow',
  'provider_override:image',
  'model_override:knowledge',
  'model_override:workflow',
  'model_override:image',
  'claude_project_settings_enabled',
  'locale',
];

const PROVIDER_SETTING_RULES: Partial<Record<string, {
  moduleKey: ProviderModuleKey;
  capability: ProviderCapability;
  label: string;
  disallowLocalAuth?: boolean;
  requiredApiProtocol?: 'anthropic-messages' | 'openai-compatible';
}>> = {
  'provider_override:knowledge': {
    moduleKey: 'knowledge',
    capability: 'text-gen',
    label: '知识库模块服务商',
    disallowLocalAuth: true,
  },
  'provider_override:workflow': {
    moduleKey: 'workflow',
    capability: 'text-gen',
    label: '工作流规划服务商',
  },
  'provider_override:image': {
    moduleKey: 'image',
    capability: 'image-gen',
    label: '图片模块服务商',
  },
  memory_intelligence_provider_id: {
    moduleKey: 'knowledge',
    capability: 'text-gen',
    label: '记忆智能服务商',
    disallowLocalAuth: true,
  },
};

function validateProviderSetting(key: string, rawValue: unknown): string {
  const strValue = String(rawValue ?? '').trim();
  const rule = PROVIDER_SETTING_RULES[key];
  if (!rule || !strValue) {
    return strValue;
  }

  const provider = resolveProviderForCapability({
    moduleKey: rule.moduleKey,
    capability: rule.capability,
    preferredProviderId: strValue,
    allowDefault: false,
  });

  if (!provider) {
    return strValue;
  }

  if (rule.disallowLocalAuth && provider.auth_mode === 'local_auth') {
    throw new ProviderResolutionError(`${rule.label}当前不支持 local_auth，请改用 API Key 类型的配置`);
  }

  if (rule.requiredApiProtocol && provider.api_protocol !== rule.requiredApiProtocol) {
    throw new ProviderResolutionError(
      `${rule.label}当前仅支持 ${rule.requiredApiProtocol} 协议，请重新选择配置`,
    );
  }

  return strValue;
}

export async function GET() {
  try {
    const result: Record<string, string> = {};
    for (const key of ALLOWED_KEYS) {
      const value = getSetting(key);
      if (value !== undefined) {
        // Mask token for security (only return last 8 chars)
        if (key === 'anthropic_auth_token' && value.length > 8) {
          result[key] = '***' + value.slice(-8);
        } else {
          result[key] = value;
        }
      }
    }
    return NextResponse.json({ settings: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read app settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      const strValue = validateProviderSetting(key, value);
      if (strValue) {
        // Don't overwrite token if user sent the masked version back
        if (key === 'anthropic_auth_token' && strValue.startsWith('***')) {
          continue;
        }
        setSetting(key, strValue);
      } else {
        // Empty value = remove the setting
        setSetting(key, '');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ProviderResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Failed to save app settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
