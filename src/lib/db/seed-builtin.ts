import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Seed built-in API providers
 */
export function seedBuiltinProviders(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) as count FROM api_providers WHERE is_builtin = 1').get() as { count: number } | undefined;

  if (count && count.count > 0) {
    console.log('[seed] Built-in providers already exist, skipping');
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const providers = [
    {
      id: crypto.randomBytes(16).toString('hex'),
      name: 'Anthropic',
      provider_type: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key: '',
      is_active: 0,
      sort_order: 0,
      extra_env: '{}',
      notes: 'Official Anthropic API',
      is_builtin: 1,
      user_modified: 0,
    },
  ];

  const stmt = db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  for (const p of providers) {
    stmt.run(p.id, p.name, p.provider_type, p.base_url, p.api_key, p.is_active, p.sort_order, p.extra_env, p.notes, p.is_builtin, p.user_modified, now, now);
  }

  console.log(`[seed] Created ${providers.length} built-in providers`);
}

/**
 * Seed built-in skills from public/skills/ directory
 */
export function seedBuiltinSkills(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) as count FROM skills WHERE scope = ?').get('builtin') as { count: number } | undefined;

  if (count && count.count > 0) {
    console.log('[seed] Built-in skills already exist, skipping');
    return;
  }

  // Find skills directory (handle both dev and production)
  let skillsDir: string;
  if (process.resourcesPath) {
    // Production: extraResources are in process.resourcesPath
    skillsDir = path.join(process.resourcesPath, 'standalone', 'public', 'skills');
  } else {
    // Development: use cwd
    skillsDir = path.join(process.cwd(), 'public', 'skills');
  }

  if (!fs.existsSync(skillsDir)) {
    console.warn('[seed] Skills directory not found:', skillsDir);
    return;
  }

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    console.warn('[seed] No skill files found in:', skillsDir);
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const stmt = db.prepare(
    'INSERT INTO skills (id, name, scope, description, file_path, content_hash, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let inserted = 0;
  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const name = path.basename(file, '.md');

    // Extract description from first line (if it's a comment)
    const firstLine = content.split('\n')[0];
    const description = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '').trim() : '';

    const id = crypto.randomBytes(16).toString('hex');
    stmt.run(id, name, 'builtin', description, filePath, hash, 1, now, now);
    inserted++;
  }

  console.log(`[seed] Created ${inserted} built-in skills`);
}

/**
 * Seed built-in MCP servers
 */
export function seedBuiltinMcpServers(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) as count FROM mcp_servers WHERE scope = ?').get('builtin') as { count: number } | undefined;

  if (count && count.count > 0) {
    console.log('[seed] Built-in MCP servers already exist, skipping');
    return;
  }

  // Find feishu-mcp-server path (handle both dev and production)
  let feishuServerPath: string;
  if (process.resourcesPath) {
    // Production: extraResources are in process.resourcesPath
    feishuServerPath = path.join(process.resourcesPath, 'feishu-mcp-server', 'index.js');
  } else {
    // Development: use resources directory
    feishuServerPath = path.join(process.cwd(), 'resources', 'feishu-mcp-server', 'index.js');
  }

  if (!fs.existsSync(feishuServerPath)) {
    console.warn('[seed] Feishu MCP server not found:', feishuServerPath);
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const servers = [
    {
      id: crypto.randomBytes(16).toString('hex'),
      name: 'feishu',
      command: 'node',
      args: JSON.stringify([feishuServerPath]),
      env: JSON.stringify({}),
      scope: 'builtin',
      source: 'builtin',
      description: 'Feishu document integration',
      type: 'stdio',
      is_enabled: 0,
    },
  ];

  const stmt = db.prepare(
    'INSERT INTO mcp_servers (id, name, command, args, env, scope, source, description, type, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  for (const s of servers) {
    stmt.run(s.id, s.name, s.command, s.args, s.env, s.scope, s.source, s.description, s.type, s.is_enabled, now, now);
  }

  console.log(`[seed] Created ${servers.length} built-in MCP servers`);
}
