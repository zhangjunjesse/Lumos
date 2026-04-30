import type Database from 'better-sqlite3';

import type { AppManifest } from '../manifest/types';

import type { BindingContext } from './binding-resolver';
import { renderTemplate, resolveBindingExpression, resolveSingleBinding } from './binding-resolver';
import type { AppDataStore } from './data-store';
import { createAppDataStore } from './data-store';
import type { PermissionGate } from './permission-gate';
import { createPermissionGate } from './permission-gate';
import type { SecretVault } from './secret-vault';

/**
 * Per-run, per-app context.
 *
 * Built whenever an application page or workflow is about to run. Bundles
 * everything a step / handler / workflow body needs to behave correctly:
 *
 *   - The app id (every operation is scoped to it).
 *   - The page that triggered the run (for telemetry).
 *   - Inputs (form values for the trigger event).
 *   - The PermissionGate snapshot, used by mcp-resolver / tool-runner /
 *     fetch / fs to allow or deny operations.
 *   - The AppDataStore (with strict app_id isolation).
 *   - The SecretVault (for resolving config values).
 *   - The cached manifest (so workflow steps can read declared `requires`
 *     without an extra DB hop).
 *   - Step outputs accumulator (workflow wires these in as steps complete).
 *   - Convenience helpers to evaluate bindings against this context.
 *
 * Context is immutable in the sense that the wired-in `vault`, `dataStore`,
 * and `gate` are stable references for the duration of a run. Step outputs
 * are mutated through the helper `recordStepOutput`. Permission changes
 * require building a new context — this is intentional, see permission-gate.
 */

export interface AppRunContextDeps {
  db: Database.Database;
  vault: SecretVault;
  appId: string;
  manifest: AppManifest;
  /** Page id that triggered this run, for telemetry / logging. */
  pageId?: string;
  /** Form / trigger inputs. */
  inputs?: Record<string, unknown>;
  /** Lumos user info, e.g. { id, name }. */
  user?: Record<string, unknown>;
  /** A trace id binding the run across the system (workflow run id). */
  runId?: string;
  /** Override the homedir used for fs path resolution (testing). */
  homeDir?: string;
}

export interface AppRunContext {
  readonly appId: string;
  readonly pageId?: string;
  readonly runId?: string;
  readonly inputs: Record<string, unknown>;
  readonly user: Record<string, unknown>;
  readonly manifest: AppManifest;
  readonly vault: SecretVault;
  readonly dataStore: AppDataStore;
  readonly gate: PermissionGate;
  /** Mutable per-run accumulator. */
  readonly stepOutputs: Record<string, { output?: unknown }>;

  /** Record a workflow step output so subsequent bindings can reference it. */
  recordStepOutput(stepId: string, output: unknown): void;

  /** Build a BindingContext snapshot tied to this run. */
  bindingContext(): BindingContext;

  /** Render a template like "{{ inputs.x }} {{ config.y }}" → string. */
  renderTemplate(template: string): string;

  /** Resolve a single binding (e.g. "{{ db.customers }}") to its raw value. */
  resolveBinding(expression: string): unknown;

  /**
   * If `template` is a sole-binding string, return the raw value;
   * otherwise return the rendered string. Used by component props that
   * may legitimately be either a literal or a typed value (table data,
   * counts, booleans).
   */
  resolveProp(template: string): unknown;
}

export function buildAppRunContext(deps: AppRunContextDeps): AppRunContext {
  const { db, vault, appId, manifest, pageId, runId, homeDir } = deps;
  const inputs = deps.inputs ?? {};
  const user = deps.user ?? {};

  const dataStore = createAppDataStore(db, appId);
  const gate = createPermissionGate(db, appId, { homeDir });
  const stepOutputs: Record<string, { output?: unknown }> = {};

  const ctx: AppRunContext = {
    appId,
    pageId,
    runId,
    inputs,
    user,
    manifest,
    vault,
    dataStore,
    gate,
    stepOutputs,

    recordStepOutput(stepId, output) {
      stepOutputs[stepId] = { output };
    },

    bindingContext(): BindingContext {
      return {
        inputs,
        user,
        steps: stepOutputs,
        dataStore,
        vault,
        appId,
      };
    },

    renderTemplate(template) {
      return renderTemplate(template, this.bindingContext());
    },

    resolveBinding(expression) {
      return resolveBindingExpression(expression, this.bindingContext());
    },

    resolveProp(template) {
      const single = resolveSingleBinding(template, this.bindingContext());
      if (single.isSingle) return single.value;
      return renderTemplate(template, this.bindingContext());
    },
  };

  return ctx;
}
