import fs from 'fs';
import os from 'os';
import path from 'path';

import type { SkillRecord } from '@/lib/db/skills';

const settingsStore = new Map<string, string>();
const skillsStore = new Map<string, SkillRecord>();

jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => settingsStore.get(key),
  setSetting: (key: string, value: string) => {
    settingsStore.set(key, value);
  },
  getSkillByNameAndScope: (name: string, scope: 'builtin' | 'user') =>
    skillsStore.get(`${scope}:${name}`),
}));

import {
  buildDefaultWritingStylePrompt,
  clearDefaultWritingSkillIfMatches,
  getDefaultWritingSkill,
  isDefaultWritingSkill,
  setDefaultWritingSkill,
} from '../default-writing-style';

let tmpDir = '';

function skill(params: {
  name: string;
  scope?: 'builtin' | 'user';
  content: string;
  enabled?: boolean;
}): SkillRecord {
  const scope = params.scope || 'user';
  const file = path.join(tmpDir, `${scope}-${params.name}.md`);
  fs.writeFileSync(file, params.content, 'utf-8');
  const record: SkillRecord = {
    id: `${scope}-${params.name}`,
    name: params.name,
    scope,
    description: params.name,
    file_path: file,
    content_hash: 'hash',
    is_enabled: params.enabled === false ? 0 : 1,
    created_at: '',
    updated_at: '',
  };
  skillsStore.set(`${scope}:${params.name}`, record);
  return record;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-default-style-'));
  settingsStore.clear();
  skillsStore.clear();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('default writing style', () => {
  it('stores, detects, and clears the default skill ref', () => {
    const record = skill({ name: 'renhua', content: '人话基础规则' });
    setDefaultWritingSkill({ name: 'renhua', scope: 'user' });

    expect(getDefaultWritingSkill()).toEqual({ name: 'renhua', scope: 'user' });
    expect(isDefaultWritingSkill(record)).toBe(true);

    clearDefaultWritingSkillIfMatches(record);
    expect(getDefaultWritingSkill()).toBeNull();
  });

  it('does not inject missing or disabled skills', () => {
    setDefaultWritingSkill({ name: 'missing', scope: 'user' });
    expect(buildDefaultWritingStylePrompt()).toBe('');

    skill({ name: 'renhua', content: '人话基础规则', enabled: false });
    setDefaultWritingSkill({ name: 'renhua', scope: 'user' });
    expect(buildDefaultWritingStylePrompt()).toBe('');
  });

  it('builds a prompt from skill body and keeps explicit user override rule', () => {
    skill({
      name: 'renhua',
      content: [
        '---',
        'description: 去 AI 味',
        '---',
        '# Renhua',
        '默认说人话。',
      ].join('\n'),
    });
    setDefaultWritingSkill({ name: 'renhua', scope: 'user' });

    const prompt = buildDefaultWritingStylePrompt();
    expect(prompt).toContain('/renhua');
    expect(prompt).toContain('默认说人话。');
    expect(prompt).toContain('本轮用户明确要求');
    expect(prompt).not.toContain('description: 去 AI 味');
  });
});
