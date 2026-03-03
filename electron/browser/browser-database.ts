/**
 * Browser Database Operations
 * 浏览器标签页和历史记录的数据库操作
 */

import Database from 'better-sqlite3';
import path from 'path';
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

export class BrowserDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(app.getPath('userData'), 'browser.db');
    this.db = new Database(dbPath || defaultPath);
    this.initialize();
  }

  private initialize(): void {
    // 创建表（如果不存在）
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

  /**
   * 保存标签页状态
   */
  saveTabState(state: TabState): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO browser_tabs
      (id, url, title, favicon, scroll_x, scroll_y, session_id, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      state.id,
      state.url,
      state.title,
      state.favicon || null,
      state.scrollPosition?.x || 0,
      state.scrollPosition?.y || 0,
      state.sessionId || null,
      state.createdAt,
      state.lastAccessedAt
    );
  }

  /**
   * 获取标签页状态
   */
  getTabState(tabId: string): TabState | null {
    const stmt = this.db.prepare(`
      SELECT * FROM browser_tabs WHERE id = ?
    `);

    const row = stmt.get(tabId) as any;
    if (!row) return null;

    return {
      id: row.id,
      url: row.url,
      title: row.title,
      favicon: row.favicon,
      scrollPosition: { x: row.scroll_x, y: row.scroll_y },
      sessionId: row.session_id,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    };
  }

  /**
   * 删除标签页状态
   */
  deleteTabState(tabId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM browser_tabs WHERE id = ?
    `);
    stmt.run(tabId);
  }

  /**
   * 获取所有标签页状态（按最后访问时间排序）
   */
  getAllTabStates(): TabState[] {
    const stmt = this.db.prepare(`
      SELECT * FROM browser_tabs ORDER BY last_accessed_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      url: row.url,
      title: row.title,
      favicon: row.favicon,
      scrollPosition: { x: row.scroll_x, y: row.scroll_y },
      sessionId: row.session_id,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    }));
  }

  /**
   * 添加历史记录
   */
  addHistory(entry: HistoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO browser_history (tab_id, url, title, visited_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(entry.tabId, entry.url, entry.title || null, entry.visitedAt);
  }

  /**
   * 获取标签页历史记录
   */
  getTabHistory(tabId: string, limit: number = 50): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM browser_history
      WHERE tab_id = ?
      ORDER BY visited_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(tabId, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      tabId: row.tab_id,
      url: row.url,
      title: row.title,
      visitedAt: row.visited_at,
    }));
  }

  /**
   * 清理旧历史记录（保留最近 N 天）
   */
  cleanupOldHistory(daysToKeep: number = 30): void {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare(`
      DELETE FROM browser_history WHERE visited_at < ?
    `);
    stmt.run(cutoffTime);
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}
