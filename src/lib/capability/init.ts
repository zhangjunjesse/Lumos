import fs from 'fs';
import { loadCapabilities } from './loader';
import { compileCodeCapability } from './executor';
import { loadPromptCapabilities } from './prompt-loader';
import { getPackage, listLegacyCapabilityFiles, savePackage } from '@/lib/db/capabilities';
import type { CapabilityCategory, CapabilityPackage, CapabilityRiskLevel } from './types';

let initialized = false;

function normalizeLegacyCategory(value: string | undefined, kind: 'code' | 'prompt'): CapabilityCategory {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'document' || normalized === 'integration' || normalized === 'browser-helper' || normalized === 'data') {
    return normalized;
  }
  if (normalized.includes('document') || normalized.includes('workflow') || normalized.includes('doc')) {
    return 'document';
  }
  return kind === 'prompt' ? 'integration' : 'data';
}

function inferRiskLevel(source: string, kind: 'code' | 'prompt'): CapabilityRiskLevel {
  const normalized = source.toLowerCase();
  if (/(execsync|spawn|child_process|fetch\(|axios|https?:\/\/)/.test(normalized)) {
    return 'high';
  }
  if (kind === 'code' && /(writefile|mkdir|rename|copyfile|unlink|rmdir|rm\()/i.test(source)) {
    return 'medium';
  }
  return kind === 'prompt' ? 'low' : 'medium';
}

function inferPermissions(source: string): CapabilityPackage['permissions'] {
  const normalized = source.toLowerCase();
  return {
    workspaceRead: /(readfile|existssync|readdirsync|readdir\(|statSync|stat\()/i.test(source),
    workspaceWrite: /(writefile|mkdir|rename|copyfile|unlink|rmdir|rm\()/i.test(source),
    shellExec: /(execsync|spawn|child_process)/.test(normalized),
    network: /(fetch\(|axios|https?:\/\/)/.test(normalized),
  };
}

function ensureLegacyCapabilitiesRegistered(): void {
  const legacyCapabilities = listLegacyCapabilityFiles();

  for (const capability of legacyCapabilities) {
    if (getPackage(capability.id)) {
      continue;
    }

    const stat = fs.statSync(capability.filePath);
    const riskLevel = inferRiskLevel(capability.source, capability.kind);
    const permissions = inferPermissions(capability.source);
    const pkg: CapabilityPackage = {
      id: capability.id,
      name: capability.name,
      description: capability.description,
      version: capability.version || '1.0.0',
      status: 'published',
      kind: capability.kind,
      category: normalizeLegacyCategory(capability.category, capability.kind),
      riskLevel,
      scope: {
        visibility: 'workspace',
      },
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      permissions,
      runtimePolicy: {
        timeoutMs: capability.kind === 'code' ? 120_000 : 60_000,
        maximumAttempts: 1,
      },
      approvalPolicy: {
        requireHumanApproval: false,
        approverRoles: [],
      },
      implementation: capability.kind === 'code'
        ? {
            kind: 'inline-code',
            source: capability.source,
            generatedSummary: capability.summary,
            usageExamples: capability.usageExamples,
          }
        : {
            kind: 'inline-prompt',
            source: capability.source,
            generatedSummary: capability.summary,
            usageExamples: capability.usageExamples,
          },
      tests: [],
      docs: {
        summary: capability.summary,
        usageExamples: capability.usageExamples,
      },
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };

    savePackage(pkg);
  }
}

export async function initializeCapabilities(): Promise<void> {
  if (initialized) return;

  try {
    ensureLegacyCapabilitiesRegistered();
    const capabilities = await loadCapabilities();

    for (const capability of capabilities) {
      if (capability.type === 'code') {
        await compileCodeCapability(capability.id, capability.content);
        console.log(`[Capability] Loaded code capability: ${capability.id}`);
      }
    }

    await loadPromptCapabilities();

    initialized = true;
    console.log(`[Capability] Initialized ${capabilities.length} capabilities`);
  } catch (error) {
    console.error('[Capability] Initialization failed:', error);
  }
}

export function getCapabilityInitStatus(): boolean {
  return initialized;
}
