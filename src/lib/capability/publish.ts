import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { CapabilityDraft, CapabilityPackage } from './types';
import { compileCodeCapability } from './executor';
import { registerPromptCapability } from './prompt-loader';
import { getPackage, savePackage } from '@/lib/db/capabilities';

function nextPatchVersion(previous?: string): string {
  if (!previous) {
    return '1.0.0';
  }

  const [majorText = '1', minorText = '0', patchText = '0'] = previous.split('.');
  const major = Number.parseInt(majorText, 10) || 1;
  const minor = Number.parseInt(minorText, 10) || 0;
  const patch = Number.parseInt(patchText, 10) || 0;
  return `${major}.${minor}.${patch + 1}`;
}

function getCapabilitySource(
  draft: CapabilityDraft
): { kind: 'code' | 'prompt'; source: string; summary: string; usageExamples: string[] } {
  const implementation = draft.implementation;

  if (implementation?.kind === 'inline-code') {
    return {
      kind: 'code',
      source: implementation.source,
      summary: implementation.generatedSummary || draft.description,
      usageExamples: implementation.usageExamples || [],
    };
  }

  if (implementation?.kind === 'inline-prompt') {
    return {
      kind: 'prompt',
      source: implementation.source,
      summary: implementation.generatedSummary || draft.description,
      usageExamples: implementation.usageExamples || [],
    };
  }

  throw new Error('Draft does not contain publishable capability source');
}

async function writeCapabilityFile(id: string, kind: 'code' | 'prompt', source: string): Promise<string> {
  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  const capabilitiesDir = path.join(dataDir, 'capabilities');
  await mkdir(capabilitiesDir, { recursive: true });

  const ext = kind === 'code' ? 'ts' : 'md';
  const filePath = path.join(capabilitiesDir, `${id}.${ext}`);
  await writeFile(filePath, source, 'utf-8');
  return filePath;
}

async function hotLoadCapability(id: string, kind: 'code' | 'prompt', source: string): Promise<void> {
  if (kind === 'code') {
    await compileCodeCapability(id, source);
    return;
  }

  registerPromptCapability(id, source);
}

export async function publishCapabilityDraft(
  draft: CapabilityDraft
): Promise<{ capability: CapabilityPackage; filePath: string }> {
  const { kind, source, summary, usageExamples } = getCapabilitySource(draft);
  const existing = getPackage(draft.id);
  const now = new Date().toISOString();
  const version = nextPatchVersion(existing?.version);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;

  const capability: CapabilityPackage = {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    version,
    digest,
    status: 'published',
    kind,
    category: draft.category,
    riskLevel: draft.riskLevel,
    scope: {
      visibility: 'workspace',
    },
    inputSchema: draft.inputSchema || {},
    outputSchema: draft.outputSchema || {},
    permissions: {
      workspaceRead: draft.permissions?.workspaceRead,
      workspaceWrite: draft.permissions?.workspaceWrite,
      shellExec: draft.permissions?.shellExec,
      network: draft.permissions?.network,
    },
    runtimePolicy: {
      timeoutMs: kind === 'code' ? 120_000 : 60_000,
      maximumAttempts: 1,
    },
    approvalPolicy: {
      requireHumanApproval: false,
      approverRoles: [],
    },
    implementation: draft.implementation!,
    tests: [],
    docs: {
      summary,
      usageExamples,
    },
    createdAt: existing?.createdAt || draft.createdAt,
    updatedAt: now,
  };

  const filePath = await writeCapabilityFile(draft.id, kind, source);
  await hotLoadCapability(draft.id, kind, source);
  savePackage(capability);

  return {
    capability,
    filePath,
  };
}
