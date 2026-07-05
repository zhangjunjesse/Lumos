import fs from 'fs';
import matter from 'gray-matter';

import { getSetting, getSkillByNameAndScope, setSetting } from '@/lib/db';
import type { SkillRecord } from '@/lib/db/skills';

export const DEFAULT_WRITING_SKILL_SETTING = 'default_writing_skill';

const MAX_DEFAULT_SKILL_CHARS = 12000;

export interface DefaultWritingSkillRef {
  name: string;
  scope: 'builtin' | 'user';
}

function parseDefaultWritingSkill(raw: string | undefined): DefaultWritingSkillRef | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DefaultWritingSkillRef>;
    if (
      typeof value.name === 'string' &&
      value.name.trim() &&
      (value.scope === 'builtin' || value.scope === 'user')
    ) {
      return { name: value.name.trim(), scope: value.scope };
    }
  } catch {
    return null;
  }
  return null;
}

export function getDefaultWritingSkill(): DefaultWritingSkillRef | null {
  return parseDefaultWritingSkill(getSetting(DEFAULT_WRITING_SKILL_SETTING));
}

export function setDefaultWritingSkill(ref: DefaultWritingSkillRef | null): DefaultWritingSkillRef | null {
  if (!ref) {
    setSetting(DEFAULT_WRITING_SKILL_SETTING, '');
    return null;
  }
  const normalized = { name: ref.name.trim(), scope: ref.scope };
  setSetting(DEFAULT_WRITING_SKILL_SETTING, JSON.stringify(normalized));
  return normalized;
}

export function isDefaultWritingSkill(skill: Pick<SkillRecord, 'name' | 'scope'>): boolean {
  const current = getDefaultWritingSkill();
  return Boolean(current && current.name === skill.name && current.scope === skill.scope);
}

export function clearDefaultWritingSkillIfMatches(skill: Pick<SkillRecord, 'name' | 'scope'>): void {
  if (isDefaultWritingSkill(skill)) {
    setDefaultWritingSkill(null);
  }
}

function readSkillBody(skill: SkillRecord): string {
  if (!fs.existsSync(skill.file_path)) return '';
  const raw = fs.readFileSync(skill.file_path, 'utf-8');
  const parsed = matter(raw).content.trim();
  return parsed || raw.trim();
}

export function buildDefaultWritingStylePrompt(): string {
  const ref = getDefaultWritingSkill();
  if (!ref) return '';

  const skill = getSkillByNameAndScope(ref.name, ref.scope);
  if (!skill || skill.is_enabled !== 1) return '';

  const body = readSkillBody(skill);
  if (!body) return '';

  const clipped = body.slice(0, MAX_DEFAULT_SKILL_CHARS);
  return [
    '## 全局默认写作风格',
    `用户已把 /${skill.name} Skill 设为所有会话的默认写作风格。`,
    '默认套用该 Skill 的基础写作规则；如果本轮用户明确要求其它风格、格式或语气，以本轮用户要求为准。',
    'Skill 里提到的命名风格皮肤或特殊模式，只有用户本轮明确点名时才启用，不要默认叠加。',
    '',
    clipped,
  ].join('\n');
}
