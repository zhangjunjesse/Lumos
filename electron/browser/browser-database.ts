/**
 * Browser Database Operations
 * 浏览器标签页和历史记录的数据库操作
 *
 * In development, better-sqlite3 may be unavailable in Electron main process
 * due ABI mismatch. This module falls back to an in-memory store in that case.
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export interface TabState {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  scrollPosition?: { x: number; y: number };
  sessionId?: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface HistoryEntry {
  id?: number;
  tabId: string;
  url: string;
  title?: string;
  visitedAt: number;
}

interface SqliteLike {
  exec: (sql: string) => void;
  close: () => void;
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
}

class MemoryStore {
  private tabs = new Map<string, TabState>();
  private history: HistoryEntry[] = [];
  private historyId = 1;
  private storagePath: string | null;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || null;
    this.load();
  }

  private load(): void {
    if (!this.storagePath) return;
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        tabs?: TabState[];
        history?: HistoryEntry[];
        historyId?: number;
      };

      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
      const history = Array.isArray(parsed.history) ? parsed.history : [];

      this.tabs.clear();
      for (const tab of tabs) {
        if (!tab?.id || !tab?.url) continue;
        this.tabs.set(tab.id, { ...tab });
      }

      this.history = history.filter((row) => !!row?.tabId && !!row?.url).map((row) => ({ ...row }));
      const maxHistoryId = this.history.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
      this.historyId = Math.max(Number(parsed.historyId) || 1, maxHistoryId + 1);
    } catch (error) {
      console.warn('[browser-db] Failed to load fallback store:', error);
    }
  }

  private persist(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(
          {
            tabs: Array.from(this.tabs.values()),
            history: this.history,
            historyId: this.historyId,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.warn('[browser-db] Failed to persist fallback store:', error);
    }
  }

  saveTabState(state: TabState): void {
    this.tabs.set(state.id, { ...state });
    this.persist();
  }

  getTabState(tabId: string): TabState | null {
    const row = this.tabs.get(tabId);
    return row ? { ...row } : null;
  }

  deleteTabState(tabId: string): void {
    this.tabs.delete(tabId);
    this.persist();
  }

  getAllTabStates(): TabState[] {
    return Array.from(this.tabs.values())
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .map((row) => ({ ...row }));
  }

  addHistory(entry: HistoryEntry): void {
    this.history.push({ ...entry, id: this.historyId++ });
    this.persist();
  }

  getTabHistory(tabId: string, limit: number): HistoryEntry[] {
    return this.history
      .filter((row) => row.tabId === tabId)
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  cleanupOldHistory(daysToKeep: number): void {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    this.history = this.history.filter((row) => row.visitedAt >= cutoff);
    this.persist();
  }
}

function openSqlite(dbPath: string): SqliteLike | null {
  const forceSqlite = process.env.LUMOS_BROWSER_DB_FORCE_SQLITE === '1';
  const isElectronRuntime = Boolean(process.versions?.electron);

  // In Electron dev/runtime, this project usually has Node-built better-sqlite3
  // for Next.js server, which mismatches Electron ABI. Prefer fallback unless forced.
  if (isElectronRuntime && !forceSqlite) {
    console.log('[browser-db] SQLite disabled in Electron runtime; using file-backed fallback store');
    return null;
  }

  try {
    // Use require at runtime to avoid hard failure when ABI mismatches.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as new (p: string) => SqliteLike;
    return new BetterSqlite3(dbPath);
  } catch (error) {
    console.warn('[browser-db] better-sqlite3 unavailable, fallback to file-backed memory store:', error instanceof Error ? error.message : error);
    return null;
  }
}

export class BrowserDatabase {
  private db: SqliteLike | null;
  private memory: MemoryStore;

  constructor(dbPath?: string) {
    const defaultPath = path.join(app.getPath('userData'), 'browser.db');
    const fallbackPath = path.join(app.getPath('userData'), 'browser-fallback.json');
    this.db = openSqlite(dbPath || defaultPath);
    this.memory = new MemoryStore(fallbackPath);
    if (this.db) {
      this.initialize();
    }
  }

  private initialize(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS browser_tabs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        favicon TEXT,
        scroll_x INTEGER DEFAULT 0,
        scroll_y INTEGER DEFAULT 0,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tab_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        visited_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_history_tab_id ON browser_history(tab_id);
      CREATE INDEX IF NOT EXISTS idx_history_visited_at ON browser_history(visited_at);
    `);
  }

  saveTabState(state: TabState): void {
    if (!this.db) {
      this.memory.saveTabState(state);
      return;
    }

    this.db
      .prepare(`
        INSERT OR REPLACE INTO browser_tabs
        (id, url, title, favicon, scroll_x, scroll_y, session_id, created_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        state.id,
        state.url,
        state.title,
        state.favicon || null,
        state.scrollPosition?.x || 0,
        state.scrollPosition?.y || 0,
        state.sessionId || null,
        state.createdAt,
        state.lastAccessedAt,
      );
  }

  getTabState(tabId: string): TabState | null {
    if (!this.db) {
      return this.memory.getTabState(tabId);
    }

    const row = this.db.prepare('SELECT * FROM browser_tabs WHERE id = ?').get(tabId) as
      | {
          id: string;
          url: string;
          title: string;
          favicon: string | null;
          scroll_x: number;
          scroll_y: number;
          session_id: string | null;
          created_at: number;
          last_accessed_at: number;
        }
      | undefined;
    if (!row) return null;

    return {
      id: row.id,
      url: row.url,
      title: row.title,
      favicon: row.favicon || undefined,
      scrollPosition: { x: row.scroll_x, y: row.scroll_y },
      sessionId: row.session_id || undefined,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    };
  }

  deleteTabState(tabId: string): void {
    if (!this.db) {
      this.memory.deleteTabState(tabId);
      return;
    }
    this.db.prepare('DELETE FROM browser_tabs WHERE id = ?').run(tabId);
  }

  getAllTabStates(): TabState[] {
    if (!this.db) {
      return this.memory.getAllTabStates();
    }

    const rows = this.db
      .prepare('SELECT * FROM browser_tabs ORDER BY last_accessed_at DESC')
      .all() as Array<{
      id: string;
      url: string;
      title: string;
      favicon: string | null;
      scroll_x: number;
      scroll_y: number;
      session_id: string | null;
      created_at: number;
      last_accessed_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      favicon: row.favicon || undefined,
      scrollPosition: { x: row.scroll_x, y: row.scroll_y },
      sessionId: row.session_id || undefined,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    }));
  }

  addHistory(entry: HistoryEntry): void {
    if (!this.db) {
      this.memory.addHistory(entry);
      return;
    }
    this.db
      .prepare(`
        INSERT INTO browser_history (tab_id, url, title, visited_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(entry.tabId, entry.url, entry.title || null, entry.visitedAt);
  }

  getTabHistory(tabId: string, limit: number = 50): HistoryEntry[] {
    if (!this.db) {
      return this.memory.getTabHistory(tabId, limit);
    }

    const rows = this.db
      .prepare(`
        SELECT * FROM browser_history
        WHERE tab_id = ?
        ORDER BY visited_at DESC
        LIMIT ?
      `)
      .all(tabId, limit) as Array<{
      id: number;
      tab_id: string;
      url: string;
      title: string | null;
      visited_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      tabId: row.tab_id,
      url: row.url,
      title: row.title || undefined,
      visitedAt: row.visited_at,
    }));
  }

  cleanupOldHistory(daysToKeep: number = 30): void {
    if (!this.db) {
      this.memory.cleanupOldHistory(daysToKeep);
      return;
    }
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    this.db
      .prepare('DELETE FROM browser_history WHERE visited_at < ?')
      .run(cutoffTime);
  }

  close(): void {
    this.db?.close();
  }
}
