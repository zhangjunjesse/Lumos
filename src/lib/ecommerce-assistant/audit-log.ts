import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import type { AuditEventKind, AuditEventRecord } from './types';

export type AuditEventRow = AppRow<AuditEventRecord>;

export interface RecordAuditOpts {
  kind: AuditEventKind;
  targetId: string;
  targetType: 'input' | 'listing' | 'candidate';
  /** input id this event ultimately rolls up to (for product-detail filtering). For 'input' targets pass the same id. */
  inputId?: string | null;
  summary?: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Best-effort write of an audit event. Failures are swallowed (with a
 * console.warn) — audit logging must NEVER block the actual user action.
 */
export function recordAuditEvent(store: AppDataStore, opts: RecordAuditOpts): void {
  try {
    const now = new Date().toISOString();
    store.create<AuditEventRecord>('audit_events', {
      kind: opts.kind,
      target_id: opts.targetId,
      target_type: opts.targetType,
      input_id: opts.inputId ?? null,
      summary: opts.summary ?? null,
      payload: opts.payload ? JSON.stringify(opts.payload) : null,
      occurred_at: now,
    });
  } catch (err) {
    console.warn('[ecommerce-assistant] audit log write failed:', err);
  }
}

export interface ListAuditOpts {
  inputId?: string;
  targetId?: string;
  kind?: AuditEventKind;
  limit?: number;
}

export function listAuditEvents(
  store: AppDataStore,
  opts: ListAuditOpts = {},
): AuditEventRow[] {
  const filter: Record<string, unknown> = {};
  if (opts.inputId) filter.input_id = opts.inputId;
  if (opts.targetId) filter.target_id = opts.targetId;
  if (opts.kind) filter.kind = opts.kind;
  return store.query<AuditEventRecord>('audit_events', {
    filter,
    orderBy: { field: 'occurred_at', direction: 'desc' },
    limit: opts.limit ?? 200,
  });
}
