/**
 * 用户自建 Skill 导入 —— 扫描「升级不覆盖」的用户目录 ~/.lumos/skills/，注册进 db(scope='user')，
 * 之后由现有 syncSkillsToPlugin 镜像进 skills-plugin → SDK 加载 + 能力面板可见(issue #31/#32/#33)。
 *
 * 关键区分(CLAUDE.md 血泪史)：
 * - 只扫 Lumos 自有数据空间 ~/.lumos/skills/，**绝不碰全局 ~/.claude/**。
 * - skills-plugin/skills 是从 db 派生的「派生目录」(syncSkillsToPlugin 会清掉不在 db 的目录)，
 *   用户/AI 不该往那写；用户 skill 的「源」在 ~/.lumos/skills/，由这里注册进 db。
 * - 与内置 skill(public/skills→scope='builtin')同名 → 跳过并告警(不静默双列/覆盖)。
 * - 清理只针对「源在 ~/.lumos/skills/ 下、但文件已不在」的 user 记录；不碰其它来源的 user skill。
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import matter from 'gray-matter'
import { dataDir } from './db/connection'
import {
  createSkill,
  deleteSkill,
  getSkillByNameAndScope,
  getSkillsByScope,
  updateSkill,
} from './db/skills'

/** 用户自建 Skill 根目录：~/.lumos/skills/（升级不覆盖）。兼容子目录 skills/user/。 */
export const USER_SKILLS_DIR = path.join(dataDir, 'skills')

interface FoundUserSkill {
  name: string
  description: string
  filePath: string
  hash: string
}

/** 收集一个根目录下的 SKILL.md：<name>/SKILL.md 文件夹技能 + <name>.md 单文件技能。 */
function collectSkillFilesIn(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'user') continue // 'user' 是子根，单独扫，避免当成技能
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.join(root, entry.name))
    } else if (entry.isDirectory()) {
      const skillMd = path.join(root, entry.name, 'SKILL.md')
      if (fs.existsSync(skillMd)) out.push(skillMd)
    }
  }
  return out
}

/** 扫描 ~/.lumos/skills/ 与 ~/.lumos/skills/user/ 下所有合法 SKILL（frontmatter 须含 name+description）。 */
function scanUserSkills(): FoundUserSkill[] {
  const files = [
    ...collectSkillFilesIn(USER_SKILLS_DIR),
    ...collectSkillFilesIn(path.join(USER_SKILLS_DIR, 'user')),
  ]
  const found: FoundUserSkill[] = []
  const seen = new Set<string>()
  for (const filePath of files) {
    let meta: { name?: string; description?: string }
    let raw: string
    try {
      raw = fs.readFileSync(filePath, 'utf-8')
      meta = matter(raw).data as { name?: string; description?: string }
    } catch (err) {
      console.warn('[user-skills] 跳过(读取/frontmatter 解析失败):', filePath, err instanceof Error ? err.message : err)
      continue
    }
    if (!meta.name || !meta.description) {
      console.warn('[user-skills] 跳过(frontmatter 缺 name/description):', filePath)
      continue
    }
    if (seen.has(meta.name)) {
      console.warn('[user-skills] 跳过(同名 user skill 重复):', meta.name, filePath)
      continue
    }
    seen.add(meta.name)
    found.push({
      name: meta.name,
      description: meta.description,
      filePath,
      hash: crypto.createHash('sha256').update(raw).digest('hex'),
    })
  }
  return found
}

/**
 * 启动时调用：把 ~/.lumos/skills/ 的用户技能注册/更新进 db(scope='user')，并注销已删除的。
 * 返回当前注册的用户技能数。调用方应随后 syncSkillsToPlugin() 让其生效。
 */
export function importUserSkills(): number {
  const found = scanUserSkills()
  const currentNames = new Set<string>()

  for (const skill of found) {
    // 与内置同名 → 跳过并告警（不静默覆盖内置，也不双列）
    if (getSkillByNameAndScope(skill.name, 'builtin')) {
      console.warn(`[user-skills] 跳过(与内置 skill 同名，请改名): ${skill.name}`)
      continue
    }
    currentNames.add(skill.name)
    const existing = getSkillByNameAndScope(skill.name, 'user')
    if (existing) {
      if (existing.content_hash !== skill.hash || existing.file_path !== skill.filePath) {
        updateSkill(existing.id, { description: skill.description, file_path: skill.filePath, content_hash: skill.hash })
      }
    } else {
      createSkill({ name: skill.name, scope: 'user', description: skill.description, file_path: skill.filePath, content_hash: skill.hash, is_enabled: true })
      console.log('[user-skills] 注册用户 skill:', skill.name)
    }
  }

  // 安全清理：只注销「源在 ~/.lumos/skills/ 下、但文件已删」的 user 记录；不碰其它来源的 user skill。
  const normalizedRoot = path.resolve(USER_SKILLS_DIR)
  for (const record of getSkillsByScope('user')) {
    const ownedHere = path.resolve(record.file_path).startsWith(normalizedRoot + path.sep)
    if (ownedHere && !currentNames.has(record.name)) {
      deleteSkill(record.id)
      console.log('[user-skills] 注销已删除的用户 skill:', record.name)
    }
  }

  return currentNames.size
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export interface WriteUserSkillResult {
  ok: boolean
  path?: string
  error?: string
}

/**
 * 脚手架：在 ~/.lumos/skills/<name>/SKILL.md 生成一个规范用户 Skill（升级不覆盖）。
 * 供 create_skill 工具用——写完调用方应 importUserSkills() + syncSkillsToPlugin() 让其立即生效。
 * 名称须 kebab-case；与内置同名拒绝。已存在则拒绝（避免误覆盖用户已有 skill）。
 */
export function writeUserSkill(name: string, description: string, body: string): WriteUserSkillResult {
  const n = name.trim()
  if (!SKILL_NAME_RE.test(n)) return { ok: false, error: 'name 必须是 kebab-case（小写字母/数字/连字符，以字母或数字开头）' }
  if (!description.trim()) return { ok: false, error: 'description 不能为空' }
  if (getSkillByNameAndScope(n, 'builtin')) return { ok: false, error: `与内置 skill 同名：${n}，请改名` }
  const dir = path.join(USER_SKILLS_DIR, n)
  const file = path.join(dir, 'SKILL.md')
  if (fs.existsSync(file)) return { ok: false, error: `用户 skill 已存在：${n}（如需改动请直接编辑 ${file}）` }
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, matter.stringify(`\n${body.trim()}\n`, { name: n, description: description.trim() }), 'utf-8')
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
