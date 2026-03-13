/**
 * Browser workspace persistence.
 *
 * Keeps browser-only state inside a dedicated database / fallback JSON store so
 * we do not touch the shared app schema.
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

export interface BrowserCaptureSettings {
  enabled: boolean;
  paused: boolean;
  retentionDays: number;
  maxEvents: number;
}

export interface BrowserContextEvent {
  id?: number;
  tabId?: string;
  pageId?: string;
  type: 'tab' | 'navigation' | 'load' | 'error' | 'download' | 'capture' | 'workflow' | 'ai';
  summary: string;
  url?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export type BrowserWorkflowStepType =
  | 'navigate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'click'
  | 'input'
  | 'keypress'
  | 'wait'
  | 'screenshot';

export interface BrowserWorkflowParameter {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
  secret?: boolean;
  description?: string;
}

export interface BrowserWorkflowStep {
  id: string;
  type: BrowserWorkflowStepType;
  label: string;
  selector?: string;
  text?: string;
  url?: string;
  value?: string;
  paramRef?: string;
  waitForText?: string;
  timeoutMs?: number;
  screenshotName?: string;
  key?: string;
  metadata?: Record<string, unknown>;
}

export interface BrowserWorkflow {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  sourceTabId?: string;
  startUrl?: string;
  parameters: BrowserWorkflowParameter[];
  steps: BrowserWorkflowStep[];
}

export interface BrowserWorkflowRunResult {
  runId: string;
  workflowId: string;
  status: 'running' | 'success' | 'error';
  finalUrl: string;
  downloadedFiles: string[];
  screenshots: string[];
  extractedData: Record<string, unknown>;
  error?: string;
  startedAt: number;
  finishedAt?: number;
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

const DEFAULT_CAPTURE_SETTINGS: BrowserCaptureSettings = {
  enabled: true,
  paused: false,
  retentionDays: 7,
  maxEvents: 600,
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonValue<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

class MemoryStore {
  private tabs = new Map<string, TabState>();
  private history: HistoryEntry[] = [];
  private historyId = 1;
  private contextEvents: BrowserContextEvent[] = [];
  private contextEventId = 1;
  private captureSettings: BrowserCaptureSettings = { ...DEFAULT_CAPTURE_SETTINGS };
  private workflows = new Map<string, BrowserWorkflow>();
  private workflowRuns = new Map<string, BrowserWorkflowRunResult>();
  private storagePath: string | null;
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly PERSIST_DELAY = 1000;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || null;
    this.load();
  }

  private load(): void {
    if (!this.storagePath) return;

    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const parsed = asObject(JSON.parse(raw));

      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
      const history = Array.isArray(parsed.history) ? parsed.history : [];
      const contextEvents = Array.isArray(parsed.contextEvents) ? parsed.contextEvents : [];
      const workflows = Array.isArray(parsed.workflows) ? parsed.workflows : [];
      const workflowRuns = Array.isArray(parsed.workflowRuns) ? parsed.workflowRuns : [];

      this.tabs.clear();
      for (const tab of tabs) {
        if (!tab || typeof tab !== 'object') continue;
        const record = tab as TabState;
        if (!record.id || !record.url) continue;
        this.tabs.set(record.id, { ...record });
      }

      this.history = history
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({ ...(row as HistoryEntry) }))
        .filter((row) => Boolean(row.tabId && row.url));

      this.contextEvents = contextEvents
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({ ...(row as BrowserContextEvent) }))
        .filter((row) => typeof row.summary === 'string');

      const settings = asObject(parsed.captureSettings);
      this.captureSettings = {
        enabled: settings.enabled !== false,
        paused: settings.paused === true,
        retentionDays: Math.max(1, Number(settings.retentionDays) || DEFAULT_CAPTURE_SETTINGS.retentionDays),
        maxEvents: Math.max(50, Number(settings.maxEvents) || DEFAULT_CAPTURE_SETTINGS.maxEvents),
      };

      this.workflows.clear();
      for (const workflow of workflows) {
        if (!workflow || typeof workflow !== 'object') continue;
        const record = workflow as BrowserWorkflow;
        if (!record.id || !record.name) continue;
        this.workflows.set(record.id, {
          ...record,
          parameters: Array.isArray(record.parameters) ? record.parameters : [],
          steps: Array.isArray(record.steps) ? record.steps : [],
        });
      }

      this.workflowRuns.clear();
      for (const run of workflowRuns) {
        if (!run || typeof run !== 'object') continue;
        const record = run as BrowserWorkflowRunResult;
        if (!record.runId || !record.workflowId) continue;
        this.workflowRuns.set(record.runId, {
          ...record,
          downloadedFiles: Array.isArray(record.downloadedFiles) ? record.downloadedFiles : [],
          screenshots: Array.isArray(record.screenshots) ? record.screenshots : [],
          extractedData: asObject(record.extractedData),
        });
      }

      const maxHistoryId = this.history.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
      const maxContextEventId = this.contextEvents.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
      this.historyId = Math.max(Number(parsed.historyId) || 1, maxHistoryId + 1);
      this.contextEventId = Math.max(Number(parsed.contextEventId) || 1, maxContextEventId + 1);
      this.cleanupContextEvents();
    } catch (error) {
      console.warn('[browser-db] Failed to load fallback store:', error);
    }
  }

  private persist(): void {
    if (!this.storagePath) return;

    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(
          {
            tabs: Array.from(this.tabs.values()),
            history: this.history,
            historyId: this.historyId,
            contextEvents: this.contextEvents,
            contextEventId: this.contextEventId,
            captureSettings: this.captureSettings,
            workflows: Array.from(this.workflows.values()),
            workflowRuns: Array.from(this.workflowRuns.values()),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.warn('[browser-db] Failed to persist fallback store:', error);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persist();
      this.persistTimer = null;
    }, this.PERSIST_DELAY);
  }

  saveTabState(state: TabState): void {
    this.tabs.set(state.id, { ...state });
    this.schedulePersist();
  }

  getTabState(tabId: string): TabState | null {
    const row = this.tabs.get(tabId);
    return row ? { ...row } : null;
  }

  deleteTabState(tabId: string): void {
    this.tabs.delete(tabId);
    this.schedulePersist();
  }

  getAllTabStates(): TabState[] {
    return Array.from(this.tabs.values())
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .map((row) => ({ ...row }));
  }

  addHistory(entry: HistoryEntry): void {
    this.history.push({ ...entry, id: this.historyId++ });
    this.schedulePersist();
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
    this.schedulePersist();
  }

  getCaptureSettings(): BrowserCaptureSettings {
    return { ...this.captureSettings };
  }

  updateCaptureSettings(settings: Partial<BrowserCaptureSettings>): BrowserCaptureSettings {
    this.captureSettings = {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : this.captureSettings.enabled,
      paused: typeof settings.paused === 'boolean' ? settings.paused : this.captureSettings.paused,
      retentionDays: Math.max(1, Number(settings.retentionDays) || this.captureSettings.retentionDays),
      maxEvents: Math.max(50, Number(settings.maxEvents) || this.captureSettings.maxEvents),
    };
    this.cleanupContextEvents();
    this.schedulePersist();
    return this.getCaptureSettings();
  }

  addContextEvent(event: BrowserContextEvent): BrowserContextEvent {
    const row: BrowserContextEvent = { ...event, id: this.contextEventId++ };
    this.contextEvents.push(row);
    this.cleanupContextEvents();
    this.schedulePersist();
    return { ...row, metadata: row.metadata ? { ...row.metadata } : undefined };
  }

  getContextEvents(options?: { limit?: number; tabId?: string }): BrowserContextEvent[] {
    const limit = Math.max(1, options?.limit || 100);
    const tabId = typeof options?.tabId === 'string' ? options.tabId : '';

    return this.contextEvents
      .filter((row) => (tabId ? row.tabId === tabId || row.pageId === tabId : true))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((row) => ({
        ...row,
        metadata: row.metadata ? { ...row.metadata } : undefined,
      }));
  }

  clearContextEvents(): void {
    this.contextEvents = [];
    this.schedulePersist();
  }

  cleanupContextEventRetention(): void {
    this.cleanupContextEvents();
    this.schedulePersist();
  }

  saveWorkflow(workflow: BrowserWorkflow): BrowserWorkflow {
    const record: BrowserWorkflow = {
      ...workflow,
      parameters: Array.isArray(workflow.parameters) ? workflow.parameters.map((row) => ({ ...row })) : [],
      steps: Array.isArray(workflow.steps) ? workflow.steps.map((row) => ({ ...row, metadata: row.metadata ? { ...row.metadata } : undefined })) : [],
    };
    this.workflows.set(record.id, record);
    this.schedulePersist();
    return {
      ...record,
      parameters: record.parameters.map((row) => ({ ...row })),
      steps: record.steps.map((row) => ({ ...row, metadata: row.metadata ? { ...row.metadata } : undefined })),
    };
  }

  getWorkflow(workflowId: string): BrowserWorkflow | null {
    const record = this.workflows.get(workflowId);
    return record
      ? {
          ...record,
          parameters: record.parameters.map((row) => ({ ...row })),
          steps: record.steps.map((row) => ({ ...row, metadata: row.metadata ? { ...row.metadata } : undefined })),
        }
      : null;
  }

  getWorkflows(): BrowserWorkflow[] {
    return Array.from(this.workflows.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({
        ...row,
        parameters: row.parameters.map((item) => ({ ...item })),
        steps: row.steps.map((item) => ({ ...item, metadata: item.metadata ? { ...item.metadata } : undefined })),
      }));
  }

  deleteWorkflow(workflowId: string): void {
    this.workflows.delete(workflowId);
    for (const run of Array.from(this.workflowRuns.values())) {
      if (run.workflowId === workflowId) {
        this.workflowRuns.delete(run.runId);
      }
    }
    this.schedulePersist();
  }

  saveWorkflowRun(result: BrowserWorkflowRunResult): BrowserWorkflowRunResult {
    const row: BrowserWorkflowRunResult = {
      ...result,
      downloadedFiles: [...result.downloadedFiles],
      screenshots: [...result.screenshots],
      extractedData: { ...asObject(result.extractedData) },
    };
    this.workflowRuns.set(row.runId, row);
    this.schedulePersist();
    return {
      ...row,
      downloadedFiles: [...row.downloadedFiles],
      screenshots: [...row.screenshots],
      extractedData: { ...row.extractedData },
    };
  }

  private cleanupContextEvents(): void {
    const cutoff = Date.now() - this.captureSettings.retentionDays * 24 * 60 * 60 * 1000;
    this.contextEvents = this.contextEvents
      .filter((row) => row.createdAt >= cutoff)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-this.captureSettings.maxEvents);
  }
}

function openSqlite(dbPath: string): SqliteLike | null {
  const forceSqlite = process.env.LUMOS_BROWSER_DB_FORCE_SQLITE === '1';
  const isElectronRuntime = Boolean(process.versions?.electron);

  if (isElectronRuntime && !forceSqlite) {
    console.log('[browser-db] SQLite disabled in Electron runtime; using file-backed fallback store');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as new (p: string) => SqliteLike;
    return new BetterSqlite3(dbPath);
  } catch (error) {
    console.warn(
      '[browser-db] better-sqlite3 unavailable, fallback to file-backed memory store:',
      error instanceof Error ? error.message : error,
    );
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
      this.ensureCaptureSettingsRow();
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

      CREATE TABLE IF NOT EXISTS browser_capture_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 1,
        paused INTEGER NOT NULL DEFAULT 0,
        retention_days INTEGER NOT NULL DEFAULT 7,
        max_events INTEGER NOT NULL DEFAULT 600
      );

      CREATE TABLE IF NOT EXISTS browser_context_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tab_id TEXT,
        page_id TEXT,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT,
        title TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_tab_id TEXT,
        start_url TEXT,
        parameters_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        final_url TEXT NOT NULL,
        downloaded_files_json TEXT NOT NULL,
        screenshots_json TEXT NOT NULL,
        extracted_data_json TEXT NOT NULL,
        error TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_history_tab_id ON browser_history(tab_id);
      CREATE INDEX IF NOT EXISTS idx_history_visited_at ON browser_history(visited_at);
      CREATE INDEX IF NOT EXISTS idx_context_created_at ON browser_context_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_context_tab_id ON browser_context_events(tab_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_updated_at ON browser_workflows(updated_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON browser_workflow_runs(workflow_id);
    `);
  }

  private ensureCaptureSettingsRow(): void {
    if (!this.db) return;

    this.db
      .prepare(`
        INSERT OR IGNORE INTO browser_capture_settings
        (id, enabled, paused, retention_days, max_events)
        VALUES (1, ?, ?, ?, ?)
      `)
      .run(
        DEFAULT_CAPTURE_SETTINGS.enabled ? 1 : 0,
        DEFAULT_CAPTURE_SETTINGS.paused ? 1 : 0,
        DEFAULT_CAPTURE_SETTINGS.retentionDays,
        DEFAULT_CAPTURE_SETTINGS.maxEvents,
      );
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
    this.db.prepare('DELETE FROM browser_history WHERE visited_at < ?').run(cutoffTime);
  }

  getCaptureSettings(): BrowserCaptureSettings {
    if (!this.db) {
      return this.memory.getCaptureSettings();
    }

    this.ensureCaptureSettingsRow();
    const row = this.db.prepare('SELECT * FROM browser_capture_settings WHERE id = 1').get() as
      | {
          enabled: number;
          paused: number;
          retention_days: number;
          max_events: number;
        }
      | undefined;

    if (!row) {
      return { ...DEFAULT_CAPTURE_SETTINGS };
    }

    return {
      enabled: row.enabled === 1,
      paused: row.paused === 1,
      retentionDays: row.retention_days,
      maxEvents: row.max_events,
    };
  }

  updateCaptureSettings(settings: Partial<BrowserCaptureSettings>): BrowserCaptureSettings {
    if (!this.db) {
      return this.memory.updateCaptureSettings(settings);
    }

    const current = this.getCaptureSettings();
    const next: BrowserCaptureSettings = {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : current.enabled,
      paused: typeof settings.paused === 'boolean' ? settings.paused : current.paused,
      retentionDays: Math.max(1, Number(settings.retentionDays) || current.retentionDays),
      maxEvents: Math.max(50, Number(settings.maxEvents) || current.maxEvents),
    };

    this.db
      .prepare(`
        INSERT OR REPLACE INTO browser_capture_settings
        (id, enabled, paused, retention_days, max_events)
        VALUES (1, ?, ?, ?, ?)
      `)
      .run(next.enabled ? 1 : 0, next.paused ? 1 : 0, next.retentionDays, next.maxEvents);

    this.cleanupContextEvents();
    return next;
  }

  addContextEvent(event: BrowserContextEvent): BrowserContextEvent {
    if (!this.db) {
      return this.memory.addContextEvent(event);
    }

    const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null;
    const result = this.db
      .prepare(`
        INSERT INTO browser_context_events
        (tab_id, page_id, type, summary, url, title, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.tabId || null,
        event.pageId || null,
        event.type,
        event.summary,
        event.url || null,
        event.title || null,
        metadataJson,
        event.createdAt,
      ) as { lastInsertRowid?: number };

    this.cleanupContextEvents();
    return {
      ...event,
      id: Number(result.lastInsertRowid) || undefined,
      metadata: event.metadata ? { ...event.metadata } : undefined,
    };
  }

  getContextEvents(options?: { limit?: number; tabId?: string }): BrowserContextEvent[] {
    if (!this.db) {
      return this.memory.getContextEvents(options);
    }

    const limit = Math.max(1, options?.limit || 100);
    const tabId = typeof options?.tabId === 'string' ? options.tabId.trim() : '';
    const rows = (tabId
      ? this.db
          .prepare(`
            SELECT * FROM browser_context_events
            WHERE tab_id = ? OR page_id = ?
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(tabId, tabId, limit)
      : this.db
          .prepare(`
            SELECT * FROM browser_context_events
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit)) as Array<{
      id: number;
      tab_id: string | null;
      page_id: string | null;
      type: BrowserContextEvent['type'];
      summary: string;
      url: string | null;
      title: string | null;
      metadata_json: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      tabId: row.tab_id || undefined,
      pageId: row.page_id || undefined,
      type: row.type,
      summary: row.summary,
      url: row.url || undefined,
      title: row.title || undefined,
      metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at,
    }));
  }

  clearContextEvents(): void {
    if (!this.db) {
      this.memory.clearContextEvents();
      return;
    }

    this.db.prepare('DELETE FROM browser_context_events').run();
  }

  saveWorkflow(workflow: BrowserWorkflow): BrowserWorkflow {
    if (!this.db) {
      return this.memory.saveWorkflow(workflow);
    }

    const row: BrowserWorkflow = {
      ...workflow,
      parameters: Array.isArray(workflow.parameters) ? workflow.parameters.map((item) => ({ ...item })) : [],
      steps: Array.isArray(workflow.steps) ? workflow.steps.map((item) => ({ ...item, metadata: item.metadata ? { ...item.metadata } : undefined })) : [],
    };

    this.db
      .prepare(`
        INSERT OR REPLACE INTO browser_workflows
        (id, name, description, source_tab_id, start_url, parameters_json, steps_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        row.id,
        row.name,
        row.description || null,
        row.sourceTabId || null,
        row.startUrl || null,
        JSON.stringify(row.parameters),
        JSON.stringify(row.steps),
        row.createdAt,
        row.updatedAt,
      );

    return row;
  }

  getWorkflow(workflowId: string): BrowserWorkflow | null {
    if (!this.db) {
      return this.memory.getWorkflow(workflowId);
    }

    const row = this.db.prepare('SELECT * FROM browser_workflows WHERE id = ?').get(workflowId) as
      | {
          id: string;
          name: string;
          description: string | null;
          source_tab_id: string | null;
          start_url: string | null;
          parameters_json: string;
          steps_json: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      sourceTabId: row.source_tab_id || undefined,
      startUrl: row.start_url || undefined,
      parameters: parseJsonValue<BrowserWorkflowParameter[]>(row.parameters_json, []),
      steps: parseJsonValue<BrowserWorkflowStep[]>(row.steps_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getWorkflows(): BrowserWorkflow[] {
    if (!this.db) {
      return this.memory.getWorkflows();
    }

    const rows = this.db
      .prepare('SELECT * FROM browser_workflows ORDER BY updated_at DESC')
      .all() as Array<{
      id: string;
      name: string;
      description: string | null;
      source_tab_id: string | null;
      start_url: string | null;
      parameters_json: string;
      steps_json: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      sourceTabId: row.source_tab_id || undefined,
      startUrl: row.start_url || undefined,
      parameters: parseJsonValue<BrowserWorkflowParameter[]>(row.parameters_json, []),
      steps: parseJsonValue<BrowserWorkflowStep[]>(row.steps_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  deleteWorkflow(workflowId: string): void {
    if (!this.db) {
      this.memory.deleteWorkflow(workflowId);
      return;
    }

    this.db.prepare('DELETE FROM browser_workflows WHERE id = ?').run(workflowId);
    this.db.prepare('DELETE FROM browser_workflow_runs WHERE workflow_id = ?').run(workflowId);
  }

  saveWorkflowRun(result: BrowserWorkflowRunResult): BrowserWorkflowRunResult {
    if (!this.db) {
      return this.memory.saveWorkflowRun(result);
    }

    const row: BrowserWorkflowRunResult = {
      ...result,
      downloadedFiles: [...result.downloadedFiles],
      screenshots: [...result.screenshots],
      extractedData: { ...asObject(result.extractedData) },
    };

    this.db
      .prepare(`
        INSERT OR REPLACE INTO browser_workflow_runs
        (id, workflow_id, status, final_url, downloaded_files_json, screenshots_json, extracted_data_json, error, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        row.runId,
        row.workflowId,
        row.status,
        row.finalUrl,
        JSON.stringify(row.downloadedFiles),
        JSON.stringify(row.screenshots),
        JSON.stringify(row.extractedData),
        row.error || null,
        row.startedAt,
        row.finishedAt || null,
      );

    return row;
  }

  private cleanupContextEvents(): void {
    if (!this.db) {
      this.memory.cleanupContextEventRetention();
      return;
    }

    const settings = this.getCaptureSettings();
    const cutoffTime = Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM browser_context_events WHERE created_at < ?').run(cutoffTime);

    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM browser_context_events').get() as { count: number };
    const overflow = Number(countRow.count) - settings.maxEvents;
    if (overflow > 0) {
      this.db
        .prepare(`
          DELETE FROM browser_context_events
          WHERE id IN (
            SELECT id FROM browser_context_events
            ORDER BY created_at ASC
            LIMIT ?
          )
        `)
        .run(overflow);
    }
  }

  close(): void {
    this.db?.close();
  }
}
