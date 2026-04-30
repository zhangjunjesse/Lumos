import {
  type DispatchPayload,
  type EventHandlers,
  dispatchEvent,
  parseEventDsl,
} from './event-dispatcher';
import type { RendererBridge } from './bridge';

/**
 * Glue: take a renderer bridge and produce the EventHandlers shape that
 * `dispatchEvent` consumes. Layouts and widgets call
 * `runEventDsl(dsl, payload, bridge, helpers)` and forget about the
 * underlying bridge calls.
 */

export interface DispatchHelpers {
  /** Called when a workflow run completes (success or failure). */
  onWorkflowResult?: (workflowId: string, output: unknown, status: 'success' | 'failed' | 'cancelled') => void;
  /** Called after any mutating db op so the caller can refresh prefetched snapshots. */
  onDbMutation?: () => void;
  /** Called for `page:<id>` events. */
  onNavigate?: (menuId: string) => void;
  /** Called for `dialog:<id>` events. */
  onOpenDialog?: (dialogId: string, payload?: unknown) => void;
  /** Confirmation prompt before destructive ops. Default: bridge.confirm. */
  confirm?: (message: string) => Promise<boolean>;
}

export async function runEventDsl(
  dsl: string,
  payload: DispatchPayload,
  bridge: RendererBridge,
  helpers: DispatchHelpers = {},
): Promise<{ ok: true; result?: unknown } | { ok: false; error: string }> {
  let parsed;
  try {
    parsed = parseEventDsl(dsl);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const handlers: EventHandlers = {
    async onWorkflow(workflowId, inputs) {
      const r = await bridge.runWorkflow(workflowId, inputs);
      helpers.onWorkflowResult?.(workflowId, r.output, r.status);
      if (r.status === 'failed' || r.status === 'cancelled') {
        bridge.toast({
          title: r.status === 'cancelled' ? '已取消' : '工作流执行失败',
          description: r.error,
          level: r.status === 'failed' ? 'error' : 'warning',
        });
        throw new Error(r.error ?? `Workflow ${workflowId} ended with ${r.status}`);
      }
      return r.output;
    },
    async onDbCreate(collection, data) {
      const created = await bridge.dbCreate(collection, data);
      helpers.onDbMutation?.();
      return { id: created.id };
    },
    async onDbUpdate(collection, id, patch) {
      const updated = await bridge.dbUpdate(collection, id, patch);
      helpers.onDbMutation?.();
      return updated;
    },
    async onDbDelete(collection, id) {
      const ok = await bridge.dbDelete(collection, id);
      if (ok) helpers.onDbMutation?.();
      return ok;
    },
    onPage(menuId) {
      if (helpers.onNavigate) helpers.onNavigate(menuId);
      else bridge.navigate(menuId);
    },
    onDialog(dialogId) {
      if (helpers.onOpenDialog) helpers.onOpenDialog(dialogId, payload.inputs);
      else bridge.openDialog(dialogId, payload.inputs);
    },
  };

  try {
    const result = await dispatchEvent(parsed, payload, handlers);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
