#!/usr/bin/env node
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const dbPath = join(homedir(), '.lumos', 'lumos.db');
const db = new Database(dbPath);

try {
  const result = db.prepare(`
    UPDATE mcp_servers
    SET is_enabled = 1
    WHERE name = 'task-management' AND scope = 'builtin'
  `).run();

  console.log(`✓ Enabled task-management MCP server (${result.changes} rows updated)`);

  const server = db.prepare(`
    SELECT name, is_enabled FROM mcp_servers WHERE name = 'task-management'
  `).get();

  console.log('Current status:', server);
} catch (error) {
  console.error('Error:', error);
} finally {
  db.close();
}
