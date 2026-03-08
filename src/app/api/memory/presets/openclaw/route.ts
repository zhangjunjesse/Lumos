import { NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { getDefaultMemoryIntelligencePrompts } from '@/lib/memory/intelligence';
import { saveMindPersonaProfile } from '@/lib/mind/profile';
import { saveMindRulesProfile } from '@/lib/mind/rules-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveRecommendedModel(): string {
  const candidates = [
    (getSetting('default_model') || '').trim(),
    (getSetting('memory_intelligence_extract_model') || '').trim(),
    (getSetting('memory_intelligence_should_model') || '').trim(),
    'claude-sonnet-4-20250514',
  ];
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return 'claude-sonnet-4-20250514';
}

export async function POST() {
  try {
    const prompts = getDefaultMemoryIntelligencePrompts();
    const model = resolveRecommendedModel();

    const settings: Record<string, string> = {
      memory_system_enabled: 'true',
      memory_context_max_items: '8',
      memory_intelligence_enabled: 'true',
      memory_intelligence_provider_id: '',
      memory_intelligence_should_model: model,
      memory_intelligence_extract_model: model,
      memory_intelligence_should_prompt: prompts.shouldPrompt,
      memory_intelligence_extract_prompt: prompts.extractPrompt,
      memory_intelligence_confidence_threshold: '0.72',
      memory_intelligence_cooldown_seconds: '180',
      memory_intelligence_daily_budget: '28',
      memory_intelligence_max_items_per_run: '3',
      memory_intelligence_window_messages: '16',
      memory_intelligence_trigger_session_switch_enabled: 'true',
      memory_intelligence_trigger_idle_enabled: 'true',
      memory_intelligence_trigger_weak_signal_enabled: 'true',
      memory_intelligence_idle_timeout_ms: '120000',
    };

    for (const [key, value] of Object.entries(settings)) {
      setSetting(key, value);
    }

    const persona = saveMindPersonaProfile({
      identity: 'Lumos',
      relationship: '长期协作伙伴，持续理解你的目标与偏好，在每次对话里保持连续性。',
      tone: '温暖、直接、务实；先结论后细节；必要时给明确下一步。',
      mission: '减少重复沟通成本，让每次协作都基于可追溯的记忆与规则持续进化。',
    }, 'preset_openclaw_nowledge');

    const rules = saveMindRulesProfile({
      collaborationStyle: '优先输出可执行结论；信息不足时先澄清关键假设；复杂任务先给分步路径。',
      responseRules: '先给结论与决策依据，再给操作步骤；引用记忆时说明“为什么命中”；不确定时显式标注。',
      safetyBoundaries: '不得伪造已执行动作；不得编造事实；不得输出敏感密钥或隐私信息；遇到高风险请求必须收敛。',
      memoryPolicy: '记忆仅在与当前意图相关时注入；当前用户指令始终高于历史偏好；发现冲突时优先最新明确指令。',
    }, 'preset_openclaw_nowledge');

    return NextResponse.json({
      success: true,
      appliedModel: model,
      appliedKeys: Object.keys(settings),
      persona,
      rules,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply preset';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
