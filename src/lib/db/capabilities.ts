import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from './connection';
import { deriveCapabilityKind } from '@/lib/capability/types';
import type { CapabilityDraft, CapabilityPackage } from '@/lib/capability/types';

interface LegacyCapabilityManifestField {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  required?: unknown;
}

interface LegacyCapabilityManifest {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  version?: unknown;
  inputs?: unknown;
  outputs?: unknown;
}

export interface LegacyCapabilityFileSummary {
  id: string;
  name: string;
  description: string;
  kind: 'code' | 'prompt';
  version?: string;
  category?: string;
  summary: string;
  usageExamples: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  source: string;
  filePath: string;
}

function getCapabilitiesDir(): string {
  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  return path.join(dataDir, 'capabilities');
}

function readHeaderValue(source: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*//\\s*${escapedLabel}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || undefined;
}

function normalizeLegacySchema(fields: unknown): Record<string, unknown> {
  if (!Array.isArray(fields)) {
    return {};
  }

  const schema: Record<string, unknown> = {};

  for (const field of fields) {
    if (!field || typeof field !== 'object') {
      continue;
    }

    const item = field as LegacyCapabilityManifestField;
    const rawName = typeof item.name === 'string' ? item.name.trim() : '';
    if (!rawName) {
      continue;
    }

    const rawType = typeof item.type === 'string' ? item.type.trim() : 'string';
    const description = typeof item.description === 'string' ? item.description.trim() : '';

    schema[rawName] = {
      type: rawType || 'string',
      ...(description ? { description } : {}),
      ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
    };
  }

  return schema;
}

function parseLegacyCapabilityManifest(raw: string): LegacyCapabilityManifest | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as LegacyCapabilityManifest;
  } catch {
    return null;
  }
}

export function listLegacyCapabilityFiles(): LegacyCapabilityFileSummary[] {
  const capabilitiesDir = getCapabilitiesDir();
  if (!fs.existsSync(capabilitiesDir)) {
    return [];
  }

  const files = fs.readdirSync(capabilitiesDir)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));

  return files.flatMap((file) => {
    const ext = path.extname(file);
    const id = path.basename(file, ext);
    const filePath = path.join(capabilitiesDir, file);
    const source = fs.readFileSync(filePath, 'utf-8');
    const sidecarPath = path.join(capabilitiesDir, `${id}.json`);
    const manifest = fs.existsSync(sidecarPath)
      ? parseLegacyCapabilityManifest(fs.readFileSync(sidecarPath, 'utf-8'))
      : null;

    const name = (
      (typeof manifest?.name === 'string' ? manifest.name : '')
      || readHeaderValue(source, 'name')
      || id
    ).trim();
    const description = (
      (typeof manifest?.description === 'string' ? manifest.description : '')
      || readHeaderValue(source, 'description')
      || name
    ).trim();
    const version = typeof manifest?.version === 'string' ? manifest.version.trim() : undefined;
    const category = typeof manifest?.category === 'string' ? manifest.category.trim() : undefined;
    const kind = ext === '.md' ? 'prompt' : 'code';

    return [{
      id,
      name,
      description,
      kind,
      ...(version ? { version } : {}),
      ...(category ? { category } : {}),
      summary: description,
      usageExamples: [],
      inputSchema: normalizeLegacySchema(manifest?.inputs),
      outputSchema: normalizeLegacySchema(manifest?.outputs),
      source,
      filePath,
    }];
  });
}

function mergePublishedSummaries<T extends { id: string }>(
  primary: T[],
  fallback: T[],
): T[] {
  const merged = new Map<string, T>();

  for (const item of fallback) {
    merged.set(item.id, item);
  }

  for (const item of primary) {
    merged.set(item.id, item);
  }

  return Array.from(merged.values());
}

export function saveDraft(draft: CapabilityDraft): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO capability_drafts (
      id, name, description, category, risk_level,
      input_schema, output_schema, permissions, implementation,
      validation_errors, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.id,
    draft.name,
    draft.description,
    draft.category,
    draft.riskLevel,
    JSON.stringify(draft.inputSchema || {}),
    JSON.stringify(draft.outputSchema || {}),
    JSON.stringify(draft.permissions || {}),
    JSON.stringify(draft.implementation || {}),
    JSON.stringify(draft.validationErrors || []),
    draft.createdAt,
    draft.updatedAt
  );
}

export function getDraft(id: string): CapabilityDraft | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM capability_drafts WHERE id = ?').get(id) as any;
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: deriveCapabilityKind(JSON.parse(row.implementation)),
    category: row.category,
    riskLevel: row.risk_level,
    inputSchema: JSON.parse(row.input_schema),
    outputSchema: JSON.parse(row.output_schema),
    permissions: JSON.parse(row.permissions),
    implementation: JSON.parse(row.implementation),
    validationErrors: JSON.parse(row.validation_errors),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDrafts(): CapabilityDraft[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM capability_drafts ORDER BY created_at DESC').all() as any[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    kind: deriveCapabilityKind(JSON.parse(row.implementation)),
    category: row.category,
    riskLevel: row.risk_level,
    inputSchema: JSON.parse(row.input_schema),
    outputSchema: JSON.parse(row.output_schema),
    permissions: JSON.parse(row.permissions),
    implementation: JSON.parse(row.implementation),
    validationErrors: JSON.parse(row.validation_errors),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function deleteDraft(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM capability_drafts WHERE id = ?').run(id);
}

export function savePackage(pkg: CapabilityPackage): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO capability_packages (
      id, name, description, version, digest, status, category, risk_level,
      scope, input_schema, output_schema, permissions, runtime_policy,
      approval_policy, implementation, tests, docs, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pkg.id,
    pkg.name,
    pkg.description,
    pkg.version,
    pkg.digest || null,
    pkg.status,
    pkg.category,
    pkg.riskLevel,
    JSON.stringify(pkg.scope),
    JSON.stringify(pkg.inputSchema || {}),
    JSON.stringify(pkg.outputSchema || {}),
    JSON.stringify(pkg.permissions || {}),
    JSON.stringify(pkg.runtimePolicy || {}),
    JSON.stringify(pkg.approvalPolicy || {}),
    JSON.stringify(pkg.implementation || {}),
    JSON.stringify(pkg.tests || []),
    JSON.stringify(pkg.docs || {}),
    pkg.createdAt,
    pkg.updatedAt
  );
}

export function getPackage(id: string): CapabilityPackage | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM capability_packages WHERE id = ?').get(id) as any;
  if (!row) return null;

  const implementation = JSON.parse(row.implementation);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    digest: row.digest || undefined,
    status: row.status,
    kind: deriveCapabilityKind(implementation),
    category: row.category,
    riskLevel: row.risk_level,
    scope: JSON.parse(row.scope),
    inputSchema: JSON.parse(row.input_schema),
    outputSchema: JSON.parse(row.output_schema),
    permissions: JSON.parse(row.permissions),
    runtimePolicy: JSON.parse(row.runtime_policy),
    approvalPolicy: JSON.parse(row.approval_policy),
    implementation,
    tests: JSON.parse(row.tests),
    docs: JSON.parse(row.docs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPackages(): CapabilityPackage[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM capability_packages ORDER BY updated_at DESC').all() as any[];

  return rows.map((row) => {
    const implementation = JSON.parse(row.implementation);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      digest: row.digest || undefined,
      status: row.status,
      kind: deriveCapabilityKind(implementation),
      category: row.category,
      riskLevel: row.risk_level,
      scope: JSON.parse(row.scope),
      inputSchema: JSON.parse(row.input_schema),
      outputSchema: JSON.parse(row.output_schema),
      permissions: JSON.parse(row.permissions),
      runtimePolicy: JSON.parse(row.runtime_policy),
      approvalPolicy: JSON.parse(row.approval_policy),
      implementation,
      tests: JSON.parse(row.tests),
      docs: JSON.parse(row.docs),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      } satisfies CapabilityPackage;
  });
}

export interface PublishedPromptCapabilitySummary {
  id: string;
  name: string;
  description: string;
  summary: string;
  usageExamples: string[];
}

export function listPublishedPromptCapabilities(): PublishedPromptCapabilitySummary[] {
  const publishedPackages = listPackages()
    .filter((item) => item.status === 'published' && item.kind === 'prompt')
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      summary: item.docs?.summary || item.description,
      usageExamples: item.docs?.usageExamples || [],
    }));

  const legacyFiles = listLegacyCapabilityFiles()
    .filter((item) => item.kind === 'prompt')
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      summary: item.summary,
      usageExamples: item.usageExamples,
    }));

  return mergePublishedSummaries(publishedPackages, legacyFiles);
}

export interface PublishedCodeCapabilitySummary {
  id: string;
  name: string;
  description: string;
  summary: string;
  usageExamples: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export function listPublishedCodeCapabilities(): PublishedCodeCapabilitySummary[] {
  const publishedPackages = listPackages()
    .filter((item) => item.status === 'published' && item.kind === 'code')
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      summary: item.docs?.summary || item.description,
      usageExamples: item.docs?.usageExamples || [],
      inputSchema: item.inputSchema || {},
      outputSchema: item.outputSchema || {},
    }));

  const legacyFiles = listLegacyCapabilityFiles()
    .filter((item) => item.kind === 'code')
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      summary: item.summary,
      usageExamples: item.usageExamples,
      inputSchema: item.inputSchema,
      outputSchema: item.outputSchema,
    }));

  return mergePublishedSummaries(publishedPackages, legacyFiles);
}
