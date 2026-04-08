/**
 * Workflow import / export: structured JSON package format.
 *
 * Export produces:
 *   { format, exportedAt, workflow (DSL), agents (keyed by original preset ID) }
 *
 * Import consumes the same format, creates real agent presets (with name-
 * conflict handling), rewrites DSL preset IDs, and returns a ready-to-save DSL.
 */
import {
  getWorkflowAgentPreset,
  getWorkflowAgentPresetByName,
  createWorkflowAgentPreset,
  type WorkflowAgentPresetConfig,
} from '@/lib/db/workflow-agent-presets';
import { getDb } from '@/lib/db/connection';
import type { AnyWorkflowDSL, WorkflowStep } from './types';

// ---------------------------------------------------------------------------
// Package format
// ---------------------------------------------------------------------------

export const PACKAGE_FORMAT = 'lumos-workflow/v1' as const;

export interface WorkflowPackageAgent {
  name: string;
  expertise: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  outputMode?: string;
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
}

export interface WorkflowPackage {
  format: typeof PACKAGE_FORMAT;
  exportedAt: string;
  workflow: AnyWorkflowDSL;
  agents: Record<string, WorkflowPackageAgent>;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const BUILTIN_PREFIX = 'builtin-';

/**
 * Build a portable package from a workflow DSL.
 * Resolves each non-builtin agent step's preset into the `agents` map.
 * The DSL itself is left unchanged (preset IDs kept as-is).
 */
export function exportWorkflowPackage(dsl: AnyWorkflowDSL): WorkflowPackage {
  const agents: Record<string, WorkflowPackageAgent> = {};

  for (const step of dsl.steps) {
    if (step.type !== 'agent') continue;
    const presetId = (step.input as Record<string, unknown> | undefined)?.preset as string | undefined;
    if (!presetId || presetId.startsWith(BUILTIN_PREFIX)) continue;
    if (agents[presetId]) continue; // already collected

    const agent = resolvePresetToPackageAgent(presetId);
    if (agent) agents[presetId] = agent;
  }

  return {
    format: PACKAGE_FORMAT,
    exportedAt: new Date().toISOString(),
    workflow: dsl,
    agents,
  };
}

function resolvePresetToPackageAgent(presetId: string): WorkflowPackageAgent | null {
  const preset = getWorkflowAgentPreset(presetId);
  if (!preset) return null;
  const c = preset.config;
  return {
    name: preset.name,
    expertise: c.expertise,
    ...(c.role ? { role: c.role } : {}),
    ...(c.systemPrompt ? { systemPrompt: c.systemPrompt } : {}),
    ...(c.model ? { model: c.model } : {}),
    ...(c.allowedTools?.length ? { allowedTools: c.allowedTools } : {}),
    ...(c.outputMode ? { outputMode: c.outputMode } : {}),
    ...(c.capabilityTags?.length ? { capabilityTags: c.capabilityTags } : {}),
    ...(c.memoryPolicy ? { memoryPolicy: c.memoryPolicy } : {}),
    ...(c.concurrencyLimit ? { concurrencyLimit: c.concurrencyLimit } : {}),
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportResult {
  dsl: AnyWorkflowDSL;
  createdPresets: Array<{ id: string; name: string }>;
}

/**
 * Import a workflow package: create agent presets and rewrite DSL preset IDs.
 *
 * - Builtin presets are left as-is.
 * - Name conflicts are resolved by appending a random 4-char suffix.
 * - Returns a new DSL with rewritten preset IDs + list of created presets.
 */
export function importWorkflowPackage(pkg: WorkflowPackage): ImportResult {
  const db = getDb();

  // Wrap everything in a transaction so partial failures get rolled back
  return db.transaction(() => {
    // Step 1: create presets, build old ID → new ID mapping
    const idMapping = new Map<string, string>();
    const createdPresets: ImportResult['createdPresets'] = [];

    for (const [oldId, agent] of Object.entries(pkg.agents)) {
      if (oldId.startsWith(BUILTIN_PREFIX)) continue;

      let name = agent.name;
      while (getWorkflowAgentPresetByName(name)) {
        const suffix = Math.random().toString(36).slice(2, 6);
        name = `${agent.name}_${suffix}`;
      }

      const preset = createWorkflowAgentPreset({
        name,
        description: agent.expertise,
        expertise: agent.expertise,
        role: agent.role as WorkflowAgentPresetConfig['role'],
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        allowedTools: agent.allowedTools as WorkflowAgentPresetConfig['allowedTools'],
        outputMode: agent.outputMode as WorkflowAgentPresetConfig['outputMode'],
        capabilityTags: agent.capabilityTags,
        memoryPolicy: agent.memoryPolicy,
        concurrencyLimit: agent.concurrencyLimit,
      });

      idMapping.set(oldId, preset.id);
      createdPresets.push({ id: preset.id, name: preset.name });
    }

    // Step 2: rewrite DSL step preset IDs
    const steps = pkg.workflow.steps.map((step): WorkflowStep => {
      if (step.type !== 'agent') return step;
      const input = step.input as Record<string, unknown> | undefined;
      const oldPresetId = input?.preset as string | undefined;
      if (!oldPresetId || !idMapping.has(oldPresetId)) return step;

      return { ...step, input: { ...input, preset: idMapping.get(oldPresetId) } };
    });

    return {
      dsl: { ...pkg.workflow, steps },
      createdPresets,
    };
  })();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidWorkflowPackage(data: unknown): data is WorkflowPackage {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (obj.format !== PACKAGE_FORMAT) return false;
  if (!obj.workflow || typeof obj.workflow !== 'object') return false;
  const wf = obj.workflow as Record<string, unknown>;
  if (!wf.version || !Array.isArray(wf.steps)) return false;
  if (obj.agents !== undefined && typeof obj.agents !== 'object') return false;
  return true;
}
