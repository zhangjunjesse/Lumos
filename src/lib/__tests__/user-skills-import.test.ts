import fs from 'fs'
import path from 'path'

jest.mock('@/lib/db/connection', () => {
  const os = require('os') // eslint-disable-line @typescript-eslint/no-require-imports
  const f = require('fs') // eslint-disable-line @typescript-eslint/no-require-imports
  const p = require('path') // eslint-disable-line @typescript-eslint/no-require-imports
  return { dataDir: f.mkdtempSync(p.join(os.tmpdir(), 'lumos-uskills-')) }
})

jest.mock('@/lib/db/skills', () => {
  const store: Record<string, Record<string, unknown>> = {}
  let seq = 0
  return {
    getSkillByNameAndScope: (name: string, scope: string) => store[`${scope}:${name}`],
    getSkillsByScope: (scope: string) => Object.values(store).filter((s) => s.scope === scope),
    createSkill: (d: Record<string, unknown>) => {
      const r = { ...d, id: `id${++seq}` }
      store[`${d.scope}:${d.name}`] = r
      return r
    },
    updateSkill: (id: string, d: Record<string, unknown>) => {
      const r = Object.values(store).find((s) => s.id === id)
      if (r) Object.assign(r, d)
      return r
    },
    deleteSkill: (id: string) => {
      const k = Object.keys(store).find((kk) => store[kk].id === id)
      if (k) delete store[k]
      return true
    },
  }
})

import { importUserSkills, writeUserSkill, USER_SKILLS_DIR } from '../user-skills-import'
import { getSkillsByScope, createSkill } from '@/lib/db/skills'

function writeSkillDir(name: string, frontmatterName: string, description: string): void {
  const dir = path.join(USER_SKILLS_DIR, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\n正文\n`)
}

beforeEach(() => {
  // 清掉用户技能目录 + db store（store 在 mock 内，靠删全部 user/builtin 记录）
  fs.rmSync(USER_SKILLS_DIR, { recursive: true, force: true })
  for (const s of [...getSkillsByScope('user'), ...getSkillsByScope('builtin')]) {
    // @ts-expect-error mock 的 deleteSkill 按 id 删
    require('@/lib/db/skills').deleteSkill((s as { id: string }).id) // eslint-disable-line @typescript-eslint/no-require-imports
  }
})

describe('importUserSkills', () => {
  it('扫描 ~/.lumos/skills/<name>/SKILL.md → 注册为 user scope', () => {
    writeSkillDir('video-subtitle-local', 'video-subtitle-local', '本地离线视频转字幕')
    const n = importUserSkills()
    expect(n).toBe(1)
    const users = getSkillsByScope('user') as Array<{ name: string; scope: string }>
    expect(users.map((s) => s.name)).toContain('video-subtitle-local')
  })

  it('与内置 skill 同名 → 跳过，不注册为 user（不静默覆盖/双列）', () => {
    createSkill({ name: 'dup-skill', scope: 'builtin', description: 'builtin', file_path: '/x/SKILL.md', content_hash: 'h', is_enabled: true } as never)
    writeSkillDir('dup-skill', 'dup-skill', '用户同名')
    importUserSkills()
    const users = getSkillsByScope('user') as Array<{ name: string }>
    expect(users.map((s) => s.name)).not.toContain('dup-skill')
  })

  it('源目录删除后再扫 → 注销该 user skill', () => {
    writeSkillDir('tmp-skill', 'tmp-skill', '临时')
    importUserSkills()
    expect((getSkillsByScope('user') as Array<{ name: string }>).map((s) => s.name)).toContain('tmp-skill')
    fs.rmSync(path.join(USER_SKILLS_DIR, 'tmp-skill'), { recursive: true, force: true })
    importUserSkills()
    expect((getSkillsByScope('user') as Array<{ name: string }>).map((s) => s.name)).not.toContain('tmp-skill')
  })
})

describe('writeUserSkill（脚手架）', () => {
  it('写出带 frontmatter 的 SKILL.md 到 ~/.lumos/skills/<name>/', () => {
    const r = writeUserSkill('my-skill', '我的技能', '步骤一二三')
    expect(r.ok).toBe(true)
    const content = fs.readFileSync(path.join(USER_SKILLS_DIR, 'my-skill', 'SKILL.md'), 'utf-8')
    expect(content).toContain('name: my-skill')
    expect(content).toContain('description: 我的技能')
    expect(content).toContain('步骤一二三')
  })

  it('非 kebab-case 名 → 拒绝', () => {
    expect(writeUserSkill('My Skill', 'd', 'b').ok).toBe(false)
  })

  it('已存在 → 拒绝（不误覆盖）', () => {
    writeUserSkill('dup2', 'd', 'b')
    const r = writeUserSkill('dup2', 'd', 'b')
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('已存在')
  })
})
