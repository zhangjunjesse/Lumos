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
const BACKUP_DIR = path.join(LUMOS_DATA_DIR, 'backup');

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
 * 迁移 Skills 从文件系统到数据库
 */
async function migrateSkills(): Promise<number> {
  let migratedCount = 0;

  if (!fs.existsSync(USER_SKILLS_DIR)) {
    console.log('[Migrate] No user skills directory found, skipping skills migration');
    return migratedCount;
  }

  const files = fs.readdirSync(USER_SKILLS_DIR).filter(f => f.endsWith('.md'));
  console.log(`[Migrate] Found ${files.length} skill files to migrate`);

  for (const file of files) {
    try {
      const filePath = path.join(USER_SKILLS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data, content: markdownContent } = matter(content);

      const name = data.name || path.basename(file, '.md');
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
      console.error(`[Migrate] Failed to migrate skill ${file}:`, error);
    }
  }

  return migratedCount;
}

/**
 * 迁移 MCP 配置从 settings.json 到数据库
 */
async function migrateMcpServers(): Promise<number> {
  let migratedCount = 0;

  // 尝试从多个可能的配置文件位置读取
  const configPaths = [
    path.join(CLAUDE_CONFIG_DIR, 'settings.json'),
    path.join(CLAUDE_CONFIG_DIR, '.claude.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];

  let mcpServers: Record<string, any> = {};

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
