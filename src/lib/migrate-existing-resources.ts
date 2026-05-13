/**
 * 数据迁移脚本：将现有用户的 Skills 和 MCP 配置迁移到新的数据库架构
 *
 * 迁移内容：
 * 1. 从文件系统迁移 Skills 到数据库（scope=user）
 * 2. 从 settings.json 迁移 MCP 配置到数据库（scope=user）
 * 3. 备份原文件
 * 4. 设置迁移标记
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import matter from 'gray-matter';
import { getDb } from './db/connection';
import { createSkill, getSkillByNameAndScope } from './db/skills';
import { createMcpServer, getMcpServerByNameAndScope } from './db/mcp-servers';

const LUMOS_DATA_DIR = path.join(os.homedir(), '.lumos');
const CLAUDE_CONFIG_DIR = path.join(LUMOS_DATA_DIR, '.claude');
const USER_SKILLS_DIR = path.join(CLAUDE_CONFIG_DIR, 'skills');
// NOTE: ~/.claude/skills/ scanning intentionally REMOVED — violates Lumos
// sandbox isolation (CLAUDE.md isolation rule #5). Only Lumos-owned dirs are
// scanned now: ~/.lumos/.claude/skills/ (legacy flat) + public/skills/ via
// init-builtin-resources.
const BACKUP_DIR = path.join(LUMOS_DATA_DIR, 'backup');
const SKILLS_V2_MIGRATION_KEY = 'resources_migrated_skills_v2';

interface SkillFileEntry {
  filePath: string;
  fallbackName: string;
}

interface LegacyMcpServerConfig {
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * 计算文件内容的 hash
 */
function calculateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 备份文件
 */
function backupFile(filePath: string, backupName: string) {
  if (fs.existsSync(filePath)) {
    ensureDir(BACKUP_DIR);
    const backupPath = path.join(BACKUP_DIR, backupName);
    fs.copyFileSync(filePath, backupPath);
    console.log(`[Migrate] Backed up ${filePath} to ${backupPath}`);
  }
}

/**
 * 收集可迁移的 skill 文件
 *
 * 仅扫描 Lumos 自有目录:
 *   ~/.lumos/.claude/skills/*.md  (legacy flat layout, before db-managed era)
 *
 * 旧版本曾扫描 ~/.claude/skills/<name>/SKILL.md 把用户全局 Claude CLI skills
 * 一锅端导入，违反沙箱隔离（CLAUDE.md isolation rule #5）。已移除。
 */
function collectSkillFiles(): SkillFileEntry[] {
  const entries: SkillFileEntry[] = [];

  if (fs.existsSync(USER_SKILLS_DIR)) {
    const files = fs.readdirSync(USER_SKILLS_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
      entries.push({
        filePath: path.join(USER_SKILLS_DIR, file),
        fallbackName: path.basename(file, '.md'),
      });
    }
  }

  const unique = new Map<string, SkillFileEntry>();
  for (const entry of entries) {
    unique.set(path.resolve(entry.filePath), entry);
  }

  return Array.from(unique.values());
}

/**
 * 迁移 Skills 从文件系统到数据库
 */
async function migrateSkills(): Promise<number> {
  let migratedCount = 0;
  const files = collectSkillFiles();

  if (files.length === 0) {
    console.log('[Migrate] No skill files found in legacy/global locations, skipping skills migration');
    return migratedCount;
  }

  console.log(`[Migrate] Found ${files.length} skill files to migrate`);

  for (const file of files) {
    try {
      const filePath = file.filePath;
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(content);

      const name = (typeof data.name === 'string' && data.name.trim())
        ? data.name.trim()
        : file.fallbackName;
      const description = data.description || '';
      const contentHash = calculateContentHash(content);

      // 检查是否已存在
      const existing = getSkillByNameAndScope(name, 'user');
      if (existing) {
        console.log(`[Migrate] Skill "${name}" already exists in database, skipping`);
        continue;
      }

      // 创建数据库记录
      createSkill({
        name,
        scope: 'user',
        description,
        file_path: filePath,
        content_hash: contentHash,
        is_enabled: true,
      });

      migratedCount++;
      console.log(`[Migrate] Migrated skill: ${name}`);
    } catch (error) {
      console.error(`[Migrate] Failed to migrate skill ${file.filePath}:`, error);
    }
  }

  return migratedCount;
}

/**
 * 增量技能迁移（v2）：用于已设置 resources_migrated=1 的老用户。
 * 只负责补齐 skills，不改动 mcp 迁移标记。
 */
async function migrateSkillsV2IfNeeded(db: ReturnType<typeof getDb>): Promise<void> {
  const migrationCheck = db.prepare('SELECT value FROM settings WHERE key = ?').get(SKILLS_V2_MIGRATION_KEY) as { value: string } | undefined;
  if (migrationCheck && migrationCheck.value === '1') {
    try {
      const { syncSkillsToPlugin } = await import('./skills-sync');
      const pluginDir = syncSkillsToPlugin();
      console.log(`[Migrate] Skills v2 already completed, plugin refreshed: ${pluginDir}`);
    } catch (error) {
      console.warn('[Migrate] Failed to refresh skills plugin:', error);
    }
    return;
  }

  const skillsCount = await migrateSkills();
  try {
    const { syncSkillsToPlugin } = await import('./skills-sync');
    const pluginDir = syncSkillsToPlugin();
    console.log(`[Migrate] Synced skills plugin to: ${pluginDir}`);
  } catch (error) {
    console.warn('[Migrate] Failed to sync skills plugin after v2 migration:', error);
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SKILLS_V2_MIGRATION_KEY, '1');
  console.log(`[Migrate] Skills v2 migration completed, imported ${skillsCount} skill(s)`);
}

/**
 * 迁移 MCP 配置从 settings.json 到数据库
 */
async function migrateMcpServers(): Promise<number> {
  let migratedCount = 0;

  // 仅扫描 Lumos 自有目录 (~/.lumos/.claude/)。曾经也扫
  // ~/.claude/settings.json 把用户全局 Claude CLI MCP 配置一锅端导入，
  // 与 skills 漏洞同构，违反沙箱隔离原则（CLAUDE.md isolation rule #6）。
  // 已移除。
  const configPaths = [
    path.join(CLAUDE_CONFIG_DIR, 'settings.json'),
    path.join(CLAUDE_CONFIG_DIR, '.claude.json'),
  ];

  let mcpServers: Record<string, LegacyMcpServerConfig> = {};

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        if (config.mcpServers) {
          mcpServers = { ...mcpServers, ...config.mcpServers };
          console.log(`[Migrate] Found MCP servers in ${configPath}`);
        }
      } catch (error) {
        console.error(`[Migrate] Failed to read config from ${configPath}:`, error);
      }
    }
  }

  const serverNames = Object.keys(mcpServers);
  if (serverNames.length === 0) {
    console.log('[Migrate] No MCP servers found in config files, skipping MCP migration');
    return migratedCount;
  }

  console.log(`[Migrate] Found ${serverNames.length} MCP servers to migrate`);

  for (const name of serverNames) {
    try {
      const server = mcpServers[name];

      // 检查是否已存在（user scope）
      const existingUser = getMcpServerByNameAndScope(name, 'user');
      if (existingUser) {
        console.log(`[Migrate] MCP server "${name}" already exists in database (user scope), skipping`);
        continue;
      }

      // 检查是否已存在（builtin scope）
      const existingBuiltin = getMcpServerByNameAndScope(name, 'builtin');
      if (existingBuiltin) {
        console.log(`[Migrate] MCP server "${name}" already exists as builtin, skipping migration`);
        continue;
      }

      // 创建数据库记录
      createMcpServer({
        name,
        scope: 'user',
        description: server.description || `MCP server: ${name}`,
        command: server.command || 'node',
        args: server.args || [],
        env: server.env || {},
        is_enabled: true,
      });

      migratedCount++;
      console.log(`[Migrate] Migrated MCP server: ${name}`);
    } catch (error) {
      console.error(`[Migrate] Failed to migrate MCP server ${name}:`, error);
    }
  }

  return migratedCount;
}

/**
 * 主迁移函数
 */
export async function migrateExistingResources(): Promise<void> {
  const db = getDb();

  // Run skills v2 step. For users where the v2 flag is set this only refreshes
  // the plugin dir via syncSkillsToPlugin(); for first-time installs it scans
  // ~/.lumos/.claude/skills/ (Lumos-owned legacy flat layout) and writes any
  // discovered skills into db.scope='user'. We no longer scan ~/.claude/skills/
  // (sandbox isolation rule #6).
  await migrateSkillsV2IfNeeded(db);

  // 检查是否已经迁移过
  const migrationCheck = db.prepare('SELECT value FROM settings WHERE key = ?').get('resources_migrated') as { value: string } | undefined;
  if (migrationCheck && migrationCheck.value === '1') {
    console.log('[Migrate] Resources already migrated, skipping');
    return;
  }

  console.log('[Migrate] Starting migration of existing resources...');

  try {
    // 备份现有配置文件
    backupFile(path.join(CLAUDE_CONFIG_DIR, 'settings.json'), 'settings.json.backup');
    backupFile(path.join(CLAUDE_CONFIG_DIR, '.claude.json'), '.claude.json.backup');

    // 迁移 Skills
    const skillsCount = await migrateSkills();
    console.log(`[Migrate] Migrated ${skillsCount} skills`);
    try {
      const { syncSkillsToPlugin } = await import('./skills-sync');
      const pluginDir = syncSkillsToPlugin();
      console.log(`[Migrate] Synced skills plugin to: ${pluginDir}`);
    } catch (error) {
      console.warn('[Migrate] Failed to sync skills plugin after full migration:', error);
    }

    // 迁移 MCP Servers
    const mcpCount = await migrateMcpServers();
    console.log(`[Migrate] Migrated ${mcpCount} MCP servers`);

    // 设置迁移标记
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('resources_migrated', '1');

    console.log('[Migrate] Migration completed successfully');
    console.log(`[Migrate] Total: ${skillsCount} skills + ${mcpCount} MCP servers`);
  } catch (error) {
    console.error('[Migrate] Migration failed:', error);
    throw error;
  }
}
