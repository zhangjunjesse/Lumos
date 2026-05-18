/**
 * R4 双通道对齐回归守卫。
 *
 * 事故根因之一：能力广告有两个独立通道（MCP hint + SDK Skills 清单），
 * 微信只在 MCP 侧补齐、Skills 侧仍缺 → 锚定 Skills 清单的 agent 仍说
 * "没有微信 Skill" 并误抓 goofish。此测试锁死 Skills 侧的微信对齐：
 * 删除 / 写坏 public/skills/wechat-assistant.md 即构建红。
 *
 * 真源：docs/agent-capability-registry.md（「广告通道不止一个」节）
 */
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SKILLS_DIR = path.resolve(__dirname, '../../../../public/skills');

function readSkillFrontmatter(file: string) {
  const content = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
  return matter(content);
}

describe('R4 Skills 通道连接器对齐', () => {
  test('微信 skill 文件存在', () => {
    expect(fs.existsSync(path.join(SKILLS_DIR, 'wechat-assistant.md'))).toBe(true);
  });

  test('微信 skill frontmatter 合法（否则 importSkills 会跳过、不会 seed/启用）', () => {
    const { data } = readSkillFrontmatter('wechat-assistant.md');
    expect(typeof data.name).toBe('string');
    expect((data.name as string).length).toBeGreaterThan(0);
    expect(typeof data.description).toBe('string');
    expect((data.description as string).length).toBeGreaterThan(0);
  });

  test('微信 skill 指向 lumos-wechat-assistant 并显式禁止用闲鱼/抖音替代', () => {
    const { content } = readSkillFrontmatter('wechat-assistant.md');
    expect(content).toContain('lumos-wechat-assistant');
    expect(content).toContain('goofish');
    // 明确禁止「抓最像的工具替代」——这正是事故里 goofish_get_inbox 的误用路径
    expect(content).toMatch(/不要(把|拿).*替代|替代/);
  });

  test('连接器 skills 对齐：抖音/飞书有 skill，微信也必须有（无白名单闸，文件在即对齐）', () => {
    const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'));
    const hasDouyin = files.some((f) => f.includes('douyin'));
    const hasFeishu = files.some((f) => f.includes('feishu'));
    const hasWeChat = files.some((f) => f.includes('wechat'));
    expect(hasDouyin).toBe(true);
    expect(hasFeishu).toBe(true);
    // 抖音/飞书有 skill 而微信无 = 事故复发条件，必须红。
    expect(hasWeChat).toBe(true);
  });
});
