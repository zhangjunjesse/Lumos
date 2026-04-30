import crypto from 'crypto';

import type Database from 'better-sqlite3';

/**
 * AppBuilder session persistence layer.
 *
 * Sessions, messages, and artifacts live in lumos_app_builder_* tables
 * (see migrations-app.ts). The state machine moves a session through:
 *
 *   gathering   — multi-turn need clarification, no files yet
 *   generating  — files being produced, may bounce back to repair
 *   installed   — first-time install succeeded; conversation continues
 *   iterating   — incremental edits on the installed app
 *   failed      — terminal; the agent or user gave up
 *
 * Artifacts are versioned per file_path: each commit bumps the version
 * for that file, so rollback to any prior state is possible. Other
 * tables (messages, sessions) keep their own append-only timeline.
 */

export type SessionStatus =
  | 'gathering'
  | 'generating'
  | 'installed'
  | 'iterating'
  | 'failed';

export type ArtifactStatus = 'draft' | 'committed' | 'rolled_back';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface BuilderSession {
  id: string;
  status: SessionStatus;
  /**
   * User-supplied app name typed at create time. Surfaced in the sidebar,
   * /apps draft cards, builder header, and post-install /apps/[id]. Stored
   * inside `needs_summary_json.appName` to avoid a column migration.
   */
  appName?: string;
  appDescription?: string;
  needsSummary?: Record<string, unknown>;
  appId?: string;
  templateId?: string;
  llmModel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BuilderMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: unknown;
  toolName?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: number;
}

export interface BuilderArtifact {
  id: string;
  sessionId: string;
  filePath: string;
  content: string;
  version: number;
  status: ArtifactStatus;
  createdAt: number;
}

export interface SessionStore {
  createSession(opts?: {
    appName?: string;
    appDescription?: string;
    templateId?: string;
    llmModel?: string;
    initialStatus?: SessionStatus;
  }): BuilderSession;
  getSession(id: string): BuilderSession | null;
  listSessions(opts?: { status?: SessionStatus; limit?: number }): BuilderSession[];
  updateStatus(id: string, status: SessionStatus): boolean;
  setNeedsSummary(id: string, summary: Record<string, unknown>): boolean;
  bindToApp(id: string, appId: string): boolean;

  appendMessage(input: {
    sessionId: string;
    role: MessageRole;
    content: unknown;
    toolName?: string;
    tokensIn?: number;
    tokensOut?: number;
  }): BuilderMessage;
  listMessages(sessionId: string): BuilderMessage[];
  countMessages(sessionId: string): number;

  saveArtifact(input: {
    sessionId: string;
    filePath: string;
    content: string;
    status?: ArtifactStatus;
  }): BuilderArtifact;
  /** Latest committed (or draft if no commit yet) version of every file. */
  getCurrentArtifacts(sessionId: string): BuilderArtifact[];
  /** All versions of one file, newest first. */
  listArtifactVersions(sessionId: string, filePath: string): BuilderArtifact[];
  /** Mark a draft as committed; opportunity to roll back is via rollbackArtifact. */
  commitArtifacts(sessionId: string): number;
  rollbackArtifact(sessionId: string, filePath: string): boolean;
}

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function createSessionStore(db: Database.Database): SessionStore {
  function nowMs(): number {
    return Date.now();
  }
  function genId(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }

  function rowToSession(r: SessionRow): BuilderSession {
    const needs = r.needs_summary_json
      ? safeJson<Record<string, unknown>>(r.needs_summary_json)
      : undefined;
    const appName =
      typeof needs?.appName === 'string' ? (needs.appName as string) : undefined;
    const appDescription =
      typeof needs?.appDescription === 'string'
        ? (needs.appDescription as string)
        : undefined;
    return {
      id: r.id,
      status: r.status,
      appName,
      appDescription,
      needsSummary: needs,
      appId: r.app_id ?? undefined,
      templateId: r.template_id ?? undefined,
      llmModel: r.llm_model ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  function rowToMessage(r: MessageRow): BuilderMessage {
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: safeJson<unknown>(r.content_json),
      toolName: r.tool_name ?? undefined,
      tokensIn: r.tokens_in ?? undefined,
      tokensOut: r.tokens_out ?? undefined,
      createdAt: r.created_at,
    };
  }

  function rowToArtifact(r: ArtifactRow): BuilderArtifact {
    return {
      id: r.id,
      sessionId: r.session_id,
      filePath: r.file_path,
      content: r.content,
      version: r.version,
      status: r.status,
      createdAt: r.created_at,
    };
  }

  return {
    createSession(opts) {
      const id = genId('bs');
      const now = nowMs();
      const status: SessionStatus = opts?.initialStatus ?? 'gathering';
      const initialSummary: Record<string, unknown> = {};
      if (opts?.appName) initialSummary.appName = opts.appName;
      if (opts?.appDescription) initialSummary.appDescription = opts.appDescription;
      const summaryJson =
        Object.keys(initialSummary).length > 0 ? JSON.stringify(initialSummary) : null;
      db.prepare(
        `INSERT INTO lumos_app_builder_sessions
         (id, status, needs_summary_json, app_id, template_id, llm_model, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      ).run(
        id,
        status,
        summaryJson,
        opts?.templateId ?? null,
        opts?.llmModel ?? null,
        now,
        now,
      );
      return {
        id,
        status,
        appName: opts?.appName,
        appDescription: opts?.appDescription,
        needsSummary: summaryJson ? initialSummary : undefined,
        templateId: opts?.templateId,
        llmModel: opts?.llmModel,
        createdAt: now,
        updatedAt: now,
      };
    },

    getSession(id) {
      const r = db
        .prepare(`SELECT * FROM lumos_app_builder_sessions WHERE id = ?`)
        .get(id) as SessionRow | undefined;
      return r ? rowToSession(r) : null;
    },

    listSessions(opts) {
      const status = opts?.status;
      const limit = opts?.limit ?? 50;
      const rows = status
        ? (db
            .prepare(
              `SELECT * FROM lumos_app_builder_sessions WHERE status = ?
               ORDER BY updated_at DESC LIMIT ?`,
            )
            .all(status, limit) as SessionRow[])
        : (db
            .prepare(
              `SELECT * FROM lumos_app_builder_sessions
               ORDER BY updated_at DESC LIMIT ?`,
            )
            .all(limit) as SessionRow[]);
      return rows.map(rowToSession);
    },

    updateStatus(id, status) {
      const info = db
        .prepare(
          `UPDATE lumos_app_builder_sessions SET status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(status, nowMs(), id);
      return info.changes > 0;
    },

    setNeedsSummary(id, summary) {
      const info = db
        .prepare(
          `UPDATE lumos_app_builder_sessions
           SET needs_summary_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(summary), nowMs(), id);
      return info.changes > 0;
    },

    bindToApp(id, appId) {
      if (!ID_RE.test(appId) || appId.length < 3) {
        throw new Error(`Invalid appId: ${appId}`);
      }
      const info = db
        .prepare(
          `UPDATE lumos_app_builder_sessions SET app_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(appId, nowMs(), id);
      return info.changes > 0;
    },

    appendMessage(input) {
      const id = genId('msg');
      const now = nowMs();
      db.prepare(
        `INSERT INTO lumos_app_builder_messages
         (id, session_id, role, content_json, tool_name, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.sessionId,
        input.role,
        JSON.stringify(input.content ?? null),
        input.toolName ?? null,
        input.tokensIn ?? null,
        input.tokensOut ?? null,
        now,
      );
      // Bump the session updated_at so listSessions sorts surface activity.
      db.prepare(
        `UPDATE lumos_app_builder_sessions SET updated_at = ? WHERE id = ?`,
      ).run(now, input.sessionId);
      return {
        id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content ?? null,
        toolName: input.toolName,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        createdAt: now,
      };
    },

    listMessages(sessionId) {
      const rows = db
        .prepare(
          `SELECT * FROM lumos_app_builder_messages
           WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(sessionId) as MessageRow[];
      return rows.map(rowToMessage);
    },

    countMessages(sessionId) {
      const r = db
        .prepare(
          `SELECT COUNT(*) AS c FROM lumos_app_builder_messages WHERE session_id = ?`,
        )
        .get(sessionId) as { c: number };
      return r.c;
    },

    saveArtifact(input) {
      const id = genId('art');
      const now = nowMs();
      const lastVersion = db
        .prepare(
          `SELECT MAX(version) AS v FROM lumos_app_builder_artifacts
           WHERE session_id = ? AND file_path = ?`,
        )
        .get(input.sessionId, input.filePath) as { v: number | null };
      const version = (lastVersion.v ?? 0) + 1;
      const status: ArtifactStatus = input.status ?? 'draft';
      db.prepare(
        `INSERT INTO lumos_app_builder_artifacts
         (id, session_id, file_path, content, version, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.sessionId, input.filePath, input.content, version, status, now);
      return {
        id,
        sessionId: input.sessionId,
        filePath: input.filePath,
        content: input.content,
        version,
        status,
        createdAt: now,
      };
    },

    getCurrentArtifacts(sessionId) {
      // For each file_path, return the highest-version row that is not
      // rolled_back.
      const rows = db
        .prepare(
          `SELECT a.*
           FROM lumos_app_builder_artifacts a
           JOIN (
             SELECT file_path, MAX(version) AS v
             FROM lumos_app_builder_artifacts
             WHERE session_id = ? AND status != 'rolled_back'
             GROUP BY file_path
           ) latest ON a.file_path = latest.file_path AND a.version = latest.v
           WHERE a.session_id = ?
           ORDER BY a.file_path`,
        )
        .all(sessionId, sessionId) as ArtifactRow[];
      return rows.map(rowToArtifact);
    },

    listArtifactVersions(sessionId, filePath) {
      const rows = db
        .prepare(
          `SELECT * FROM lumos_app_builder_artifacts
           WHERE session_id = ? AND file_path = ?
           ORDER BY version DESC`,
        )
        .all(sessionId, filePath) as ArtifactRow[];
      return rows.map(rowToArtifact);
    },

    commitArtifacts(sessionId) {
      const info = db
        .prepare(
          `UPDATE lumos_app_builder_artifacts
           SET status = 'committed'
           WHERE session_id = ? AND status = 'draft'`,
        )
        .run(sessionId);
      return Number(info.changes);
    },

    rollbackArtifact(sessionId, filePath) {
      // Mark the current top version as rolled_back. Subsequent
      // getCurrentArtifacts will surface the previous version.
      const info = db
        .prepare(
          `UPDATE lumos_app_builder_artifacts
           SET status = 'rolled_back'
           WHERE id = (
             SELECT id FROM lumos_app_builder_artifacts
             WHERE session_id = ? AND file_path = ? AND status != 'rolled_back'
             ORDER BY version DESC LIMIT 1
           )`,
        )
        .run(sessionId, filePath);
      return info.changes > 0;
    },
  };
}

// ───── DB row types ─────

interface SessionRow {
  id: string;
  status: SessionStatus;
  needs_summary_json: string | null;
  app_id: string | null;
  template_id: string | null;
  llm_model: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  content_json: string;
  tool_name: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: number;
}

interface ArtifactRow {
  id: string;
  session_id: string;
  file_path: string;
  content: string;
  version: number;
  status: ArtifactStatus;
  created_at: number;
}

function safeJson<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null as unknown as T;
  }
}
