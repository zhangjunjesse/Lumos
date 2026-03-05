import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';

// Import schema initialization from src/lib/db
// Note: This works because the schema file is pure TypeScript with no browser dependencies
import { initDb } from '../../src/lib/db/schema';

let db: Database.Database | null = null;

/**
 * Get the database path based on environment
 */
export function getDbPath(): string {
  const dataDir =
    process.env.LUMOS_DATA_DIR ||
    process.env.CLAUDE_GUI_DATA_DIR ||
    path.join(os.homedir(), '.lumos');

  return path.join(dataDir, 'lumos.db');
}

/**
 * Initialize the database connection in Main Process
 * TODO: 暂时禁用，因为与 Next.js 共享 better-sqlite3 有 ABI 冲突
 */
export function initDatabase(): Database.Database {
  console.log('[db] Database initialization disabled in Electron main process');
  return null as any;
}

/**
 * Get the database instance
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection gracefully
 */
export function closeDb(): void {
  if (db) {
    try {
      db.close();
      console.log('[db] Database closed gracefully');
    } catch (err) {
      console.warn('[db] Error closing database:', err);
    }
    db = null;
  }
}

/**
 * Register shutdown handlers
 */
export function registerDbShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[db] Received ${signal}, closing database...`);
    closeDb();
  };

  app.on('before-quit', () => shutdown('before-quit'));
  app.on('will-quit', () => shutdown('will-quit'));

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    shutdown('SIGINT');
    process.exit(0);
  });

  if (process.platform === 'win32') {
    process.on('SIGHUP', () => {
      shutdown('SIGHUP');
      process.exit(0);
    });
  }
}
