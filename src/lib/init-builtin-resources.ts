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
  getSetting,
  setSetting,
} from './db';

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

function getPublicDir(): string {
  // In production (Electron), public files are in app.asar/public
  // In development, they're in the project root
  if (process.env.NODE_ENV === 'production') {
    return path.join(process.resourcesPath, 'app.asar', 'public');
  }
  return path.join(process.cwd(), 'public');
}

// ==========================================
// Import Skills
// ==========================================

function importSkills(): number {
  const publicDir = getPublicDir();
  const skillsDir = path.join(publicDir, 'skills');

  if (!fs.existsSync(skillsDir)) {
    console.warn('[init-builtin-resources] Skills directory not found:', skillsDir);
    return 0;
  }

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  let imported = 0;

  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: prompt } = matter(content);

    const metadata = data as SkillMetadata;
    if (!metadata.name || !metadata.description) {
      console.warn('[init-builtin-resources] Invalid skill metadata in:', file);
      continue;
    }

    const contentHash = calculateFileHash(filePath);
    const existing = getSkillByNameAndScope(metadata.name, 'builtin');

    if (existing) {
      // Update if content changed
      if (existing.content_hash !== contentHash) {
        updateSkill(existing.id, {
          description: metadata.description,
          file_path: filePath,
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated skill:', metadata.name);
      }
    } else {
      // Create new skill
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
  const publicDir = getPublicDir();
  const mcpDir = path.join(publicDir, 'mcp-servers');

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

    const contentHash = calculateFileHash(filePath);
    const existing = getMcpServerByNameAndScope(config.name, 'builtin');

    if (existing) {
      // Update if content changed
      if (existing.content_hash !== contentHash) {
        updateMcpServer(existing.id, {
          description: config.description,
          command: config.command,
          args: config.args,
          env: config.env,
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated MCP server:', config.name);
      }
    } else {
      // Create new MCP server
      createMcpServer({
        name: config.name,
        scope: 'builtin',
        description: config.description || '',
        command: config.command,
        args: config.args,
        env: config.env,
        is_enabled: true,
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
// Main Initialization
// ==========================================

export async function initBuiltinResources(): Promise<void> {
  try {
    // Check if already imported
    const imported = getSetting('builtin_resources_imported');
    if (imported === 'true') {
      console.log('[init-builtin-resources] Builtin resources already imported, checking for updates...');
    }

    // Import skills
    const skillsImported = importSkills();
    console.log(`[init-builtin-resources] Skills: ${skillsImported} new, checked all for updates`);

    // Import MCP servers
    const mcpImported = importMcpServers();
    console.log(`[init-builtin-resources] MCP servers: ${mcpImported} new, checked all for updates`);

    // Mark as imported
    setSetting('builtin_resources_imported', 'true');
    console.log('[init-builtin-resources] Builtin resources initialization complete');
  } catch (error) {
    console.error('[init-builtin-resources] Failed to initialize builtin resources:', error);
    throw error;
  }
}


