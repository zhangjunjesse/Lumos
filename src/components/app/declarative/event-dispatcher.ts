/**
 * Event-DSL parser + dispatcher.
 *
 * Page JSON references actions as compact strings:
 *   "workflow:<id>"
 *   "db:create:<collection>" | "db:update:<collection>" | "db:delete:<collection>"
 *   "im:notify"
 *   "native:<integration>:<action>"
 *   "page:<id>"
 *   "dialog:<id>"
 *
 * `parseEventDsl` validates and decodes; `dispatchEvent` invokes the matching
 * handler callback. Both are pure logic (no React, no DOM) so they live in
 * a .ts file and can be unit-tested in Jest.
 *
 * The dispatcher does NOT enforce permissions itself — that's the gate's
 * job (see runtime/permission-gate.ts). Wiring these together happens in
 * the page renderer's onSubmit / onAction handlers.
 */

export type ParsedEvent =
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'db'; op: 'create' | 'update' | 'delete'; collection: string }
  | { kind: 'im'; op: 'notify' }
  | { kind: 'native'; integration: string; action: string }
  | { kind: 'page'; menuId: string }
  | { kind: 'dialog'; dialogId: string };

export class EventParseError extends Error {
  readonly raw: string;
  constructor(raw: string, message: string) {
    super(`Event '${raw}': ${message}`);
    this.name = 'EventParseError';
    this.raw = raw;
  }
}

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function parseEventDsl(dsl: string): ParsedEvent {
  if (typeof dsl !== 'string' || dsl === '') {
    throw new EventParseError(String(dsl), 'empty event');
  }
  const parts = dsl.split(':');
  switch (parts[0]) {
    case 'workflow': {
      if (parts.length !== 2) {
        throw new EventParseError(dsl, 'workflow event must be workflow:<id>');
      }
      const id = parts[1];
      if (!ID_RE.test(id)) {
        throw new EventParseError(dsl, `invalid workflow id '${id}'`);
      }
      return { kind: 'workflow', workflowId: id };
    }
    case 'db': {
      if (parts.length !== 3) {
        throw new EventParseError(
          dsl,
          'db event must be db:<create|update|delete>:<collection>',
        );
      }
      const op = parts[1];
      if (op !== 'create' && op !== 'update' && op !== 'delete') {
        throw new EventParseError(dsl, `unknown db op '${op}'`);
      }
      const collection = parts[2];
      if (!COLLECTION_RE.test(collection)) {
        throw new EventParseError(dsl, `invalid collection '${collection}'`);
      }
      return { kind: 'db', op, collection };
    }
    case 'page': {
      if (parts.length !== 2) {
        throw new EventParseError(dsl, 'page event must be page:<menu-id>');
      }
      const id = parts[1];
      if (!ID_RE.test(id)) {
        throw new EventParseError(dsl, `invalid menu id '${id}'`);
      }
      return { kind: 'page', menuId: id };
    }
    case 'im': {
      if (parts.length !== 2 || parts[1] !== 'notify') {
        throw new EventParseError(dsl, 'im event must be im:notify');
      }
      return { kind: 'im', op: 'notify' };
    }
    case 'native': {
      if (parts.length !== 3) {
        throw new EventParseError(dsl, 'native event must be native:<integration>:<action>');
      }
      const integration = parts[1];
      const action = parts[2];
      if (!ID_RE.test(integration)) {
        throw new EventParseError(dsl, `invalid native integration '${integration}'`);
      }
      if (!ID_RE.test(action)) {
        throw new EventParseError(dsl, `invalid native action '${action}'`);
      }
      return { kind: 'native', integration, action };
    }
    case 'dialog': {
      if (parts.length !== 2) {
        throw new EventParseError(dsl, 'dialog event must be dialog:<id>');
      }
      const id = parts[1];
      if (!ID_RE.test(id)) {
        throw new EventParseError(dsl, `invalid dialog id '${id}'`);
      }
      return { kind: 'dialog', dialogId: id };
    }
    default:
      throw new EventParseError(
        dsl,
        `unknown event kind '${parts[0]}'; known: workflow / db / im / native / page / dialog`,
      );
  }
}

/**
 * Handlers are async to accommodate workflow runs and DB writes that go
 * through IPC. The dispatcher returns whatever the handler returns so
 * the renderer can forward results into the result region.
 */
export interface EventHandlers {
  onWorkflow: (workflowId: string, inputs: Record<string, unknown>) => Promise<unknown>;
  onDbCreate: (collection: string, data: Record<string, unknown>) => Promise<{ id: string }>;
  onDbUpdate: (
    collection: string,
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<unknown>;
  onDbDelete: (collection: string, id: string) => Promise<boolean>;
  onImNotify: (payload: Record<string, unknown>) => Promise<unknown>;
  onNativeAction: (
    integration: string,
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  onPage: (menuId: string) => void;
  onDialog: (dialogId: string) => void;
}

export interface DispatchPayload {
  /** Resolved input values for workflow / db.create. */
  inputs?: Record<string, unknown>;
  /** Required for db:update / db:delete. */
  rowId?: string;
  /** Patch fields for db:update. */
  patch?: Record<string, unknown>;
  /** Data for db:create. */
  data?: Record<string, unknown>;
}

export async function dispatchEvent(
  event: ParsedEvent,
  payload: DispatchPayload,
  handlers: EventHandlers,
): Promise<unknown> {
  switch (event.kind) {
    case 'workflow':
      return handlers.onWorkflow(event.workflowId, payload.inputs ?? {});

    case 'db': {
      switch (event.op) {
        case 'create':
          return handlers.onDbCreate(event.collection, payload.data ?? payload.inputs ?? {});
        case 'update':
          if (!payload.rowId) {
            throw new EventParseError(
              `db:update:${event.collection}`,
              'rowId required for db:update',
            );
          }
          return handlers.onDbUpdate(event.collection, payload.rowId, payload.patch ?? payload.inputs ?? {});
        case 'delete':
          if (!payload.rowId) {
            throw new EventParseError(
              `db:delete:${event.collection}`,
              'rowId required for db:delete',
            );
          }
          return handlers.onDbDelete(event.collection, payload.rowId);
      }
      // unreachable
      return undefined;
    }

    case 'page':
      handlers.onPage(event.menuId);
      return undefined;

    case 'im':
      return handlers.onImNotify(payload.data ?? payload.inputs ?? {});

    case 'native':
      return handlers.onNativeAction(
        event.integration,
        event.action,
        {
          ...(payload.inputs ?? {}),
          ...(payload.data ?? {}),
          ...(payload.rowId ? { rowId: payload.rowId } : {}),
        },
      );

    case 'dialog':
      handlers.onDialog(event.dialogId);
      return undefined;
  }
}
