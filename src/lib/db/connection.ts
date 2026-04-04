import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { initDb } from './schema';

export const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
export const DB_PATH = path.join(dataDir, 'lumos.db');

let db: Database.Database | null = null;

/**
 * Migrate data from ~/.codepilot/ to ~/.lumos/
 * This runs once when ~/.lumos/ doesn't exist yet.
 */
function migrateFromCodePilot(): void {
  const home = os.homedir();
  const oldDir = path.join(home, '.codepilot');
  const newDir = path.join(home, '.lumos');

  // Skip if already migrated
  if (fs.existsSync(newDir)) {
    return;
  }

  // Skip if old directory doesn't exist
  if (!fs.existsSync(oldDir)) {
    return;
  }

  console.log('[migration] Starting CodePilot → Lumos migration...');

  try {
    // Create new directory
    fs.mkdirSync(newDir, { recursive: true });

    // Copy database files
    const oldDb = path.join(oldDir, 'codepilot.db');
    const newDb = path.join(newDir, 'lumos.db');

    if (fs.existsSync(oldDb)) {
      fs.copyFileSync(oldDb, newDb);
      console.log('[migration] ✓ Copied database');

      // Copy WAL and SHM files if they exist
      if (fs.existsSync(oldDb + '-wal')) {
        fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
        console.log('[migration] ✓ Copied WAL file');
      }
      if (fs.existsSync(oldDb + '-shm')) {
        fs.copyFileSync(oldDb + '-shm', newDb + '-shm');
        console.log('[migration] ✓ Copied SHM file');
      }
    }

    // Copy .claude directory
    const oldClaudeDir = path.join(oldDir, '.claude');
    const newClaudeDir = path.join(newDir, '.claude');

    if (fs.existsSync(oldClaudeDir)) {
      copyDirectory(oldClaudeDir, newClaudeDir);
      console.log('[migration] ✓ Copied .claude directory');
    }

    console.log('[migration] Migration completed successfully!');
    console.log('[migration] Old data preserved at:', oldDir);
    console.log('[migration] New data location:', newDir);
  } catch (err) {
    console.error('[migration] Migration failed:', err);
    // Clean up partial migration
    if (fs.existsSync(newDir)) {
      try {
        fs.rmSync(newDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error('[migration] Failed to clean up:', cleanupErr);
      }
    }
  }
}

/**
 * Recursively copy directory contents
 */
function copyDirectory(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function getDb(): Database.Database {
  if (!db) {
    // Run migration before anything else
    migrateFromCodePilot();

    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Migrate from old locations if the new DB doesn't exist yet
    if (!fs.existsSync(DB_PATH)) {
      const home = os.homedir();
      const oldPaths = [
        path.join(home, '.codepilot', 'codepilot.db'),
        path.join(home, '.codepilot', 'lumos.db'),
        path.join(home, 'Library', 'Application Support', 'CodePilot', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'codepilot', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'Claude GUI', 'codepilot.db'),
        path.join(process.cwd(), 'data', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'CodePilot', 'claude-gui.db'),
        path.join(home, 'Library', 'Application Support', 'codepilot', 'claude-gui.db'),
      ];
      for (const oldPath of oldPaths) {
        if (fs.existsSync(oldPath)) {
          try {
            fs.copyFileSync(oldPath, DB_PATH);
            if (fs.existsSync(oldPath + '-wal')) fs.copyFileSync(oldPath + '-wal', DB_PATH + '-wal');
            if (fs.existsSync(oldPath + '-shm')) fs.copyFileSync(oldPath + '-shm', DB_PATH + '-shm');
            console.log(`[db] Migrated database from ${oldPath}`);
            break;
          } catch (err) {
            console.warn(`[db] Failed to migrate from ${oldPath}:`, err);
          }
        }
      }
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 30000');
    db.pragma('foreign_keys = ON');
    initDb(db);

    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
    if (!isTestEnv) {
      // Initialize builtin resources (Skills and MCP servers) after DB is ready
      // This runs on every startup to check for updates
      import('../init-builtin-resources').then(({ initBuiltinResources }) => {
        initBuiltinResources().catch(err => {
          console.error('[db] Failed to initialize builtin resources:', err);
        });
      }).catch(err => {
        console.error('[db] Failed to load init-builtin-resources module:', err);
      });

      // Migrate existing user resources from file system to database
      // This only runs once (checked by migration flag in database)
      import('../migrate-existing-resources').then(({ migrateExistingResources }) => {
        migrateExistingResources().catch(err => {
          console.error('[db] Failed to migrate existing resources:', err);
        });
      }).catch(err => {
        console.error('[db] Failed to load migrate-existing-resources module:', err);
      });

      // Start knowledge ingest worker for resumable directory imports
      import('../knowledge/ingest-worker').then(({ ensureKnowledgeIngestWorker }) => {
        ensureKnowledgeIngestWorker();
      }).catch(err => {
        console.error('[db] Failed to start ingest worker:', err);
      });
    }
  }
  return db;
}

/**
 * Close the database connection gracefully.
 * In WAL mode, this ensures the WAL is checkpointed and the
 * -wal/-shm files are cleaned up properly.
 */
export function closeDb(options?: { silent?: boolean }): void {
  if (db) {
    try {
      db.close();
      if (!options?.silent) {
        console.log('[db] Database closed gracefully');
      }
    } catch (err) {
      console.warn('[db] Error closing database:', err);
    }
    db = null;
  }
}

function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const silent = signal === 'exit';
    if (!silent) {
      console.log(`[db] Received ${signal}, closing database...`);
    }
    closeDb({ silent });
  };

  process.on('exit', () => shutdown('exit'));

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

registerShutdownHandlers();
