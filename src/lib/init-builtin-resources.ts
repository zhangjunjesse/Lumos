import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import {
  createSkill,
  getDefaultProvider,
  getSkillByNameAndScope,
  getSkillsByScope,
  updateSkill,
  deleteSkill,
  createMcpServer,
  getMcpServerByNameAndScope,
  updateMcpServer,
  setSetting,
  getBuiltinProvider,
} from './db';
import { getDb } from './db';
import { initializeCapabilities } from './capability/init';
import { seedBuiltinWorkflowAgentPresets } from './db/workflow-agent-presets';
import { resolveProviderPersistenceFields } from './provider-config';

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
  const currentNames = new Set<string>();

  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(content);

    const metadata = data as SkillMetadata;
    if (!metadata.name || !metadata.description) {
      console.warn('[init-builtin-resources] Invalid skill metadata in:', file);
      continue;
    }
    currentNames.add(metadata.name);

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

  // Remove builtin skills that no longer exist in public/skills
  const existingBuiltin = getSkillsByScope('builtin');
  const removed: string[] = [];
  for (const skill of existingBuiltin) {
    if (!currentNames.has(skill.name)) {
      if (deleteSkill(skill.id)) {
        removed.push(skill.name);
      }
    }
  }
  if (removed.length > 0) {
    console.log(`[init-builtin-resources] Removed builtin skills: ${removed.join(', ')}`);
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

    // Keep placeholders (e.g. [RUNTIME_PATH]) in DB config.
    // They are resolved at request-time in chat route where full context
    // (workspace/data dir) is available.
    const args = config.args || [];
    const contentHash = calculateFileHash(filePath);
    const existing = getMcpServerByNameAndScope(config.name, 'builtin');

    if (existing) {
      if (existing.content_hash !== contentHash) {
        let mergedEnv = config.env || {};
        try {
          const existingEnv = JSON.parse(existing.env || '{}') as Record<string, string>;
          // Preserve user-edited env values on builtin upgrades (e.g. API keys).
          mergedEnv = {
            ...(config.env || {}),
            ...existingEnv,
          };
        } catch {
          // Keep builtin defaults if existing env cannot be parsed
        }
        updateMcpServer(existing.id, {
          description: config.description,
          command: config.command,
          args,
          env: mergedEnv,
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated MCP server:', config.name);
      }
    } else {
      // task-management, workflow, and deepsearch are enabled by default for core orchestration flows
      const isEnabled = config.name === 'task-management'
        || config.name === 'workflow'
        || config.name === 'deepsearch'
        || config.name === 'office-docs';
      createMcpServer({
        name: config.name,
        scope: 'builtin',
        description: config.description || '',
        command: config.command,
        args,
        env: config.env,
        is_enabled: isEnabled,
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
  const fields = resolveProviderPersistenceFields({
    providerType: 'anthropic',
    capabilities: ['agent-chat'],
    providerOrigin: 'system',
    authMode: 'api_key',
    isBuiltin: 1,
  });

  const resolvedDefaultProvider = getDefaultProvider();
  const shouldBecomeDefaultProvider = !resolvedDefaultProvider;
  const isActive = shouldBecomeDefaultProvider ? 1 : 0;

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, api_protocol, capabilities, provider_origin, auth_mode, base_url, api_key, is_active, sort_order, extra_env, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    'Anthropic (Built-in)',
    fields.providerType,
    fields.apiProtocol,
    fields.capabilities,
    fields.providerOrigin,
    fields.authMode,
    '',
    '',
    isActive,
    0,
    '{}',
    'Built-in provider. Fill in your API key to activate.',
    1,
    0,
    now,
    now,
  );

  if (shouldBecomeDefaultProvider) {
    setSetting('default_provider_id', id);
  }

  console.log(
    `[init-builtin-resources] Created built-in Anthropic provider (default=${shouldBecomeDefaultProvider}, is_active=${isActive})`,
  );
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

    await initializeCapabilities();

    seedBuiltinWorkflowAgentPresets();

    setSetting('builtin_resources_imported', 'true');
    console.log('[init-builtin-resources] Done');
  } catch (error) {
    console.error('[init-builtin-resources] Failed:', error);
    throw error;
  }
}
