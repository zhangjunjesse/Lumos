import { getSetting, setSetting } from '@/lib/db';
import { DIGEST_SYSTEM } from './daily-review-schema';

// 总结（单会话 digest）用的系统提示词。可配置：用户没改时用写死的 DIGEST_SYSTEM。
const DIGEST_PROMPT_KEY = 'memory_v2_digest_prompt';
const DIGEST_PROMPT_VERSION_KEY = 'memory_v2_digest_prompt_version';
// digest 输出结构每次变更就 bump：旧版本存的自定义提示词会让模型按旧结构输出、
// schema 对不上导致静默失败，所以版本不匹配时自动作废自定义、回退默认（自愈）。
const DIGEST_PROMPT_VERSION = 'events-insights-v1';

export interface DigestPromptState {
  prompt: string; // 当前生效的提示词
  isCustom: boolean; // 是否用户自定义（false = 用内置默认）
  defaultPrompt: string; // 内置默认，供 UI 展示/恢复
}

export function getDigestPrompt(): DigestPromptState {
  const custom = (getSetting(DIGEST_PROMPT_KEY) || '').trim();
  const version = (getSetting(DIGEST_PROMPT_VERSION_KEY) || '').trim();
  // 自定义但版本不是当前结构 → 视为失效，回退默认（不静默炸）。
  const valid = custom.length > 0 && version === DIGEST_PROMPT_VERSION;
  return {
    prompt: valid ? custom : DIGEST_SYSTEM,
    isCustom: valid,
    defaultPrompt: DIGEST_SYSTEM,
  };
}

// 空 / 全空白 / 等于默认 → 清除自定义，回到内置默认；否则连同当前结构版本一起存。
export function setDigestPrompt(value: string): DigestPromptState {
  const trimmed = (value || '').trim();
  const keep = trimmed && trimmed !== DIGEST_SYSTEM;
  setSetting(DIGEST_PROMPT_KEY, keep ? trimmed : '');
  setSetting(DIGEST_PROMPT_VERSION_KEY, keep ? DIGEST_PROMPT_VERSION : '');
  return getDigestPrompt();
}
