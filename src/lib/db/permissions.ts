import { getDb } from './connection';

// ==========================================
// Permission Request Operations
// ==========================================

/**
 * Create a pending permission request record in DB.
 */
export function createPermissionRequest(params: {
  id: string;
  sessionId: string;
  sdkSessionId?: string;
  toolName: string;
  toolInput: string;
  decisionReason?: string;
  expiresAt: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO permission_requests (id, session_id, sdk_session_id, tool_name, tool_input, decision_reason, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    params.id,
    params.sessionId,
    params.sdkSessionId || '',
    params.toolName,
    params.toolInput,
    params.decisionReason || '',
    params.expiresAt,
  );
}

/**
 * Resolve a pending permission request. Only updates if status is still 'pending'.
 * Returns true if the request was found and resolved, false otherwise.
 */
export function resolvePermissionRequest(
  id: string,
  status: 'allow' | 'deny' | 'timeout' | 'aborted',
  opts?: {
    updatedPermissions?: unknown[];
    updatedInput?: Record<string, unknown>;
    message?: string;
  },
): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare(
    `UPDATE permission_requests
     SET status = ?, resolved_at = ?, updated_permissions = ?, updated_input = ?, message = ?
     WHERE id = ? AND status = 'pending'`
  ).run(
    status,
    now,
    JSON.stringify(opts?.updatedPermissions || []),
    opts?.updatedInput ? JSON.stringify(opts.updatedInput) : null,
    opts?.message || '',
    id,
  );
  return result.changes > 0;
}

/**
 * Expire all pending permission requests that have passed their expiry time.
 */
export function expirePermissionRequests(now?: string): number {
  const db = getDb();
  const cutoff = now || new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare(
    `UPDATE permission_requests
     SET status = 'timeout', resolved_at = ?, message = 'Expired'
     WHERE status = 'pending' AND expires_at < ?`
  ).run(cutoff, cutoff);
  return result.changes;
}

/**
 * Get a permission request by ID.
 */
export function getPermissionRequest(id: string): {
  id: string;
  session_id: string;
  sdk_session_id: string;
  tool_name: string;
  tool_input: string;
  decision_reason: string;
  status: string;
  updated_permissions: string;
  updated_input: string | null;
  message: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
} | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(id) as ReturnType<typeof getPermissionRequest>;
}
