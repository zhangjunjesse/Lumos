import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import {
  createSkill,
  getSkillByNameAndScope,
  updateSkill,
  createMcpServer,
  getMcpServerByNameAndScope,
  updateMcpServer,
  setSetting,
  getBuiltinProvider,
} from './db';
import { getDb } from './db';

// ==========================================
// Types
// ==========================================

interface SkillMetadata {
  name: string;
  description: string;
}

interface McpServerConfig {
  name: string;
  description: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// ==========================================
// Helper Functions
// ==========================================

function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get the public directory path.
 * In production (Electron), public files are in extraResources/standalone/public/
 * In development, they're in the project root/public/
 */
function getPublicDir(): string {
  if (process.resourcesPath) {
    const prodPath = path.join(process.resourcesPath, 'standalone', 'public');
    if (fs.existsSync(prodPath)) return prodPath;
  }
  return path.join(process.cwd(), 'public');
}

/**
 * Get the feishu-mcp-server runtime path.
 * In production, it's in extraResources/feishu-mcp-server/
 */
function getFeishuServerPath(): string {
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'feishu-mcp-server', 'index.js');
  }
  return path.join(process.cwd(), 'resources', 'feishu-mcp-server', 'index.js');
}

// ==========================================
// Import Skills
// ==========================================

function importSkills(): number {
  const skillsDir = path.join(getPublicDir(), 'skills');

  if (!fs.existsSync(skillsDir)) {
    console.warn('[init-builtin-resources] Skills directory not found:', skillsDir);
    return 0;
  }

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  let imported = 0;

  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(content);

    const metadata = data as SkillMetadata;
    if (!metadata.name || !metadata.description) {
      console.warn('[init-builtin-resources] Invalid skill metadata in:', file);
      continue;
    }

    const contentHash = calculateFileHash(filePath);
    const existing = getSkillByNameAndScope(metadata.name, 'builtin');

    if (existing) {
      if (existing.content_hash !== contentHash) {
        updateSkill(existing.id, {
          description: metadata.description,
          file_path: filePath,
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated skill:', metadata.name);
      }
    } else {
      createSkill({
        name: metadata.name,
        scope: 'builtin',
        description: metadata.description,
        file_path: filePath,
        content_hash: contentHash,
        is_enabled: true,
      });
      console.log('[init-builtin-resources] Imported skill:', metadata.name);
      imported++;
    }
  }

  return imported;
}

// ==========================================
// Import MCP Servers
// ==========================================

function importMcpServers(): number {
  const mcpDir = path.join(getPublicDir(), 'mcp-servers');

  if (!fs.existsSync(mcpDir)) {
    console.warn('[init-builtin-resources] MCP servers directory not found:', mcpDir);
    return 0;
  }

  const feishuServerPath = getFeishuServerPath();
  const files = fs.readdirSync(mcpDir).filter(f => f.endsWith('.json'));
  let imported = 0;

  for (const file of files) {
    const filePath = path.join(mcpDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as McpServerConfig;

    if (!config.name || !config.command) {
      console.warn('[init-builtin-resources] Invalid MCP config in:', file);
      continue;
    }

    // Replace [RUNTIME_PATH] placeholder in args with actual runtime directory
    const runtimeDir = path.dirname(feishuServerPath);
    const args = (config.args || []).map(arg => arg.replace('[RUNTIME_PATH]', runtimeDir));

    // Hash includes the resolved path so it updates if the path changes
    const contentHash = crypto.createHash('sha256').update(content + runtimeDir).digest('hex');
    const existing = getMcpServerByNameAndScope(config.name, 'builtin');

    if (existing) {
      if (existing.content_hash !== contentHash) {
        updateMcpServer(existing.id, {
          description: config.description,
          command: config.command,
          args,
          env: config.env,
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated MCP server:', config.name);
      }
    } else {
      createMcpServer({
        name: config.name,
        scope: 'builtin',
        description: config.description || '',
        command: config.command,
        args,
        env: config.env,
        is_enabled: false,
        source: 'builtin',
        content_hash: contentHash,
      });
      console.log('[init-builtin-resources] Imported MCP server:', config.name);
      imported++;
    }
  }

  return imported;
}

// ==========================================
// Import Built-in Providers
// ==========================================

function importProviders(): void {
  const existing = getBuiltinProvider();
  if (existing) return;

  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Check if there's already an active provider
  const activeProvider = db.prepare('SELECT id FROM api_providers WHERE is_active = 1 LIMIT 1').get();
  const isActive = activeProvider ? 0 : 1;

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'Anthropic (Built-in)', 'anthropic', '', '', isActive, 0, '{}', 'Built-in provider. Fill in your API key to activate.', 1, 0, now, now);

  console.log(`[init-builtin-resources] Created built-in Anthropic provider (is_active=${isActive})`);
}

// ==========================================
// Main Initialization
// ==========================================

export async function initBuiltinResources(): Promise<void> {
  try {
    const skillsImported = importSkills();
    console.log(`[init-builtin-resources] Skills: ${skillsImported} new`);

    const mcpImported = importMcpServers();
    console.log(`[init-builtin-resources] MCP servers: ${mcpImported} new`);

    importProviders();

    setSetting('builtin_resources_imported', 'true');
    console.log('[init-builtin-resources] Done');
  } catch (error) {
    console.error('[init-builtin-resources] Failed:', error);
    throw error;
  }
}
