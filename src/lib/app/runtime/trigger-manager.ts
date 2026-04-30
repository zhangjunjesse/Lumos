import crypto from 'crypto';

import type Database from 'better-sqlite3';

import type { Trigger } from '../manifest/types';

/**
 * Persists app-declared triggers (manifest.triggers) into lumos_app_triggers.
 *
 * Actual scheduling and event-bus dispatch belong to lumos's existing
 * scheduling infrastructure (src/lib/scheduling) and are wired up in M3
 * when the app workflow runtime integration lands. This module's job is
 * limited to: durable storage, listing, and clearing on uninstall.
 *
 * `manual` triggers do not produce a row — they are implicit (every app
 * can be opened and run manually).
 */

export interface PersistedTrigger {
  id: string;
  appId: string;
  type: 'schedule' | 'event';
  configJson: string;
  workflowId: string;
  enabled: boolean;
}

export interface TriggerManager {
  register(appId: string, triggers: Trigger[] | undefined): PersistedTrigger[];
  list(appId: string): PersistedTrigger[];
  unregister(appId: string): number;
  setEnabled(triggerId: string, enabled: boolean): boolean;
}

export function createTriggerManager(db: Database.Database): TriggerManager {
  return {
    register(appId, triggers): PersistedTrigger[] {
      if (!triggers || triggers.length === 0) return [];
      const out: PersistedTrigger[] = [];
      const stmt = db.prepare(
        `INSERT INTO lumos_app_triggers (id, app_id, type, config_json, workflow_id, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const tx = db.transaction((items: Trigger[]) => {
        for (const t of items) {
          if (t.type === 'manual') continue;
          const id = `trg_${crypto.randomBytes(8).toString('hex')}`;
          const configJson =
            t.type === 'schedule'
              ? JSON.stringify({ cron: t.cron, input: t.input ?? null })
              : JSON.stringify({ event: t.event });
          stmt.run(id, appId, t.type, configJson, t.workflow, 1);
          out.push({
            id,
            appId,
            type: t.type,
            configJson,
            workflowId: t.workflow,
            enabled: true,
          });
        }
      });
      tx(triggers);
      return out;
    },

    list(appId): PersistedTrigger[] {
      const rows = db
        .prepare(
          `SELECT id, app_id, type, config_json, workflow_id, enabled
           FROM lumos_app_triggers WHERE app_id = ? ORDER BY id`,
        )
        .all(appId) as {
        id: string;
        app_id: string;
        type: 'schedule' | 'event';
        config_json: string;
        workflow_id: string;
        enabled: number;
      }[];
      return rows.map((r) => ({
        id: r.id,
        appId: r.app_id,
        type: r.type,
        configJson: r.config_json,
        workflowId: r.workflow_id,
        enabled: r.enabled === 1,
      }));
    },

    unregister(appId): number {
      const info = db
        .prepare(`DELETE FROM lumos_app_triggers WHERE app_id = ?`)
        .run(appId);
      return info.changes as number;
    },

    setEnabled(triggerId, enabled): boolean {
      const info = db
        .prepare(`UPDATE lumos_app_triggers SET enabled = ? WHERE id = ?`)
        .run(enabled ? 1 : 0, triggerId);
      return info.changes > 0;
    },
  };
}
