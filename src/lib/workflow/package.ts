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
import {
  getAgentPreset,
  getAgentPresetByName,
  createAgentPreset,
} from '@/lib/db/agent-presets';
import { getDb } from '@/lib/db/connection';
import type { AnyWorkflowDSL, WorkflowStep } from './types';

// ---------------------------------------------------------------------------
// Package format
// ---------------------------------------------------------------------------

export const PACKAGE_FORMAT = 'lumos-workflow/v1' as const;

/** 'workflow-agent' = templates.type='workflow-agent'; 'conversation' = templates.type='conversation' */
export type PackageAgentPresetType = 'workflow-agent' | 'conversation';

export interface WorkflowPackageAgent {
  presetType: PackageAgentPresetType;
  name: string;
  // workflow-agent fields
  expertise?: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  outputMode?: string;
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  // conversation preset fields
  roleKind?: string;
  responsibility?: string;
  description?: string;
  collaborationStyle?: string;
  outputContract?: string;
  preferredModel?: string;
  mcpServers?: string[];
  position?: string;
  interests?: string;
  specialties?: string;
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
 * Checks both workflow-agent and conversation presets (same order as runtime).
 */
export function exportWorkflowPackage(dsl: AnyWorkflowDSL): WorkflowPackage {
  const agents: Record<string, WorkflowPackageAgent> = {};
  const missing: string[] = [];

  for (const step of dsl.steps) {
    if (step.type !== 'agent') continue;
    const presetId = (step.input as Record<string, unknown> | undefined)?.preset as string | undefined;
    if (!presetId || presetId.startsWith(BUILTIN_PREFIX)) continue;
    if (agents[presetId]) continue;

    const agent = resolvePresetToPackageAgent(presetId);
    if (agent) {
      agents[presetId] = agent;
    } else {
      missing.push(`step "${step.id}" 引用的 preset ${presetId}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`导出失败：以下 Agent 预设不存在或已删除:\n${missing.join('\n')}`);
  }

  return {
    format: PACKAGE_FORMAT,
    exportedAt: new Date().toISOString(),
    workflow: dsl,
    agents,
  };
}

function resolvePresetToPackageAgent(presetId: string): WorkflowPackageAgent | null {
  // 1. Try workflow-agent preset
  const wfPreset = getWorkflowAgentPreset(presetId);
  if (wfPreset) {
    const c = wfPreset.config;
    return {
      presetType: 'workflow-agent',
      name: wfPreset.name,
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

  // 2. Try conversation preset
  const convPreset = getAgentPreset(presetId);
  if (convPreset) {
    return {
      presetType: 'conversation',
      name: convPreset.name,
      systemPrompt: convPreset.systemPrompt,
      ...(convPreset.roleKind ? { roleKind: convPreset.roleKind } : {}),
      ...(convPreset.responsibility ? { responsibility: convPreset.responsibility } : {}),
      ...(convPreset.description ? { description: convPreset.description } : {}),
      ...(convPreset.collaborationStyle ? { collaborationStyle: convPreset.collaborationStyle } : {}),
      ...(convPreset.outputContract ? { outputContract: convPreset.outputContract } : {}),
      ...(convPreset.preferredModel ? { preferredModel: convPreset.preferredModel } : {}),
      ...(convPreset.mcpServers?.length ? { mcpServers: convPreset.mcpServers } : {}),
      ...(convPreset.position ? { position: convPreset.position } : {}),
      ...(convPreset.interests ? { interests: convPreset.interests } : {}),
      ...(convPreset.specialties ? { specialties: convPreset.specialties } : {}),
    };
  }

  return null;
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
 * - Creates the correct preset type (workflow-agent or conversation).
 */
export function importWorkflowPackage(pkg: WorkflowPackage): ImportResult {
  const db = getDb();

  return db.transaction(() => {
    const idMapping = new Map<string, string>();
    const createdPresets: ImportResult['createdPresets'] = [];

    for (const [oldId, agent] of Object.entries(pkg.agents)) {
      if (oldId.startsWith(BUILTIN_PREFIX)) continue;

      // Backward compat: old packages don't have presetType
      const presetType: PackageAgentPresetType = agent.presetType || 'workflow-agent';

      let name = agent.name;
      while (isNameTaken(name, presetType)) {
        const suffix = Math.random().toString(36).slice(2, 6);
        name = `${agent.name}_${suffix}`;
      }

      let newId: string;
      if (presetType === 'conversation') {
        const created = createAgentPreset({
          name,
          systemPrompt: agent.systemPrompt || '',
          roleKind: agent.roleKind as 'worker' | undefined,
          responsibility: agent.responsibility,
          description: agent.description,
          collaborationStyle: agent.collaborationStyle,
          outputContract: agent.outputContract,
          preferredModel: agent.preferredModel,
          mcpServers: agent.mcpServers,
          position: agent.position,
          interests: agent.interests,
          specialties: agent.specialties,
        });
        newId = created.id;
      } else {
        const created = createWorkflowAgentPreset({
          name,
          description: agent.expertise || '',
          expertise: agent.expertise || '',
          role: agent.role as WorkflowAgentPresetConfig['role'],
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          allowedTools: agent.allowedTools as WorkflowAgentPresetConfig['allowedTools'],
          outputMode: agent.outputMode as WorkflowAgentPresetConfig['outputMode'],
          capabilityTags: agent.capabilityTags,
          memoryPolicy: agent.memoryPolicy,
          concurrencyLimit: agent.concurrencyLimit,
        });
        newId = created.id;
      }

      idMapping.set(oldId, newId);
      createdPresets.push({ id: newId, name });
    }

    // Rewrite DSL step preset IDs
    const steps = pkg.workflow.steps.map((step): WorkflowStep => {
      if (step.type !== 'agent') return step;
      const input = step.input as Record<string, unknown> | undefined;
      const oldPresetId = input?.preset as string | undefined;
      if (!oldPresetId || !idMapping.has(oldPresetId)) return step;
      return { ...step, input: { ...input, preset: idMapping.get(oldPresetId) } };
    });

    return { dsl: { ...pkg.workflow, steps }, createdPresets };
  })();
}

function isNameTaken(name: string, presetType: PackageAgentPresetType): boolean {
  if (presetType === 'conversation') {
    return !!getAgentPresetByName(name);
  }
  return !!getWorkflowAgentPresetByName(name);
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
