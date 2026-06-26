/**
 * lumos-skills —— 用户自建 Skill 脚手架（in-process MCP，主 agent 会话可用）。
 *
 * create_skill 把 Skill 写到「升级不覆盖」的用户目录 ~/.lumos/skills/<name>/SKILL.md，并立即注册 +
 * 同步进 skills-plugin → 能力面板可见、AI 下一轮可调用（issue #31/#32/#33）。
 * 绝不写 skills-plugin/skills（那是从 db 派生的目录，会被同步/升级清掉，正是 #31 丢 skill 的原因）。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { importUserSkills, writeUserSkill } from '@/lib/user-skills-import'
import { syncSkillsToPlugin } from '@/lib/skills-sync'

export const LUMOS_SKILLS_MCP_SERVER_NAME = 'lumos-skills'

export const LUMOS_SKILLS_MCP_SYSTEM_HINT = `
## 创建用户自建 Skill
需要为用户新建一个 Skill 时，用 \`mcp__lumos-skills__create_skill(name, description, instructions)\`：
- 它会写到「升级不覆盖」的用户目录 \`~/.lumos/skills/<name>/\`，并自动注册、同步、在能力面板可见。
- **绝不要手动把 Skill 写进 \`skills-plugin/skills\`**——那个目录会被同步/升级整体刷新覆盖，用户 Skill 会丢失（这是已知事故 #31）。
- name 用 kebab-case（如 \`video-subtitle-local\`）；instructions 是 Skill 的正文（做什么、步骤、用到的脚本/命令）。
- 若 Skill 需要附带脚本（如 transcribe.py），create_skill 建好目录后，把脚本也放进同一个 \`~/.lumos/skills/<name>/\` 目录里。
`

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export function createLumosSkillsMcpServer() {
  return createSdkMcpServer({
    name: LUMOS_SKILLS_MCP_SERVER_NAME,
    tools: [
      tool(
        'create_skill',
        '创建一个用户自建 Skill：在升级不覆盖的用户目录 ~/.lumos/skills/<name>/ 生成规范 SKILL.md，并注册到能力面板、立即可被调用。绝不要把 Skill 写进会被升级覆盖的 skills-plugin 目录。',
        {
          name: z.string().min(1).describe('Skill 名，kebab-case（小写字母/数字/连字符），如 video-subtitle-local'),
          description: z.string().min(1).describe('一句话说明这个 Skill 干什么（会进 frontmatter，用于 AI 判断何时调用）'),
          instructions: z.string().min(1).describe('Skill 正文（Markdown）：做什么、步骤、用到的脚本/命令等'),
        },
        async (args): Promise<CallToolResult> => {
          try {
            const w = writeUserSkill(args.name, args.description, args.instructions)
            if (!w.ok) return json({ ok: false, error: w.error })
            importUserSkills() // 注册进 db(scope='user')
            syncSkillsToPlugin() // 镜像进 skills-plugin → SDK 加载
            return json({
              ok: true,
              path: w.path,
              note: '已创建并注册到 ~/.lumos/skills/（升级不会丢），已同步，能力面板可见；新会话即可调用。若该 Skill 需要脚本，把脚本文件也放进同一目录。',
            })
          } catch (error) {
            return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
          }
        },
      ),
    ],
  })
}

function json(data: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], ...(isError ? { isError: true } : {}) }
}
