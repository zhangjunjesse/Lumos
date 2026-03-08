import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import type { MCPServerConfig } from "@/types";
import {
  createMcpServer,
  createSkill,
  getAllMcpServers,
  getAllSkills,
  getMcpServerByNameAndScope,
  getSkillByNameAndScope,
  updateMcpServer,
  updateSkill,
} from "@/lib/db";
import { dataDir } from "@/lib/db/connection";

export const runtime = "nodejs";

type Scope = "builtin" | "user";
type ConflictStrategy = "skip" | "replace" | "rename";

interface SkillPackItem {
  name: string;
  description: string;
  content: string;
  isEnabled: boolean;
  scope: Scope;
}

interface McpPackItem {
  name: string;
  description: string;
  isEnabled: boolean;
  scope: Scope;
  config: MCPServerConfig;
}

interface ExtensionPack {
  format: "lumos-extension-pack";
  version: 1;
  generatedAt: string;
  skills: SkillPackItem[];
  mcpServers: McpPackItem[];
  metadata: {
    redactedEnvKeys: string[];
    redactedHeaderKeys: string[];
  };
}

interface ExportActionRequest {
  action: "export";
  options?: {
    mode?: "all" | "selected";
    includeSkills?: boolean;
    includeMcpServers?: boolean;
    includeBuiltin?: boolean;
    includeDisabled?: boolean;
    selectedSkills?: Array<{ name: string; scope?: Scope }>;
    selectedMcpServers?: Array<{ name: string; scope?: Scope }>;
  };
}

interface PreviewImportActionRequest {
  action: "preview-import";
  pack: Partial<ExtensionPack>;
}

interface ApplyImportActionRequest {
  action: "apply-import";
  pack: Partial<ExtensionPack>;
  conflictStrategy?: ConflictStrategy;
}

type ActionRequest =
  | ExportActionRequest
  | PreviewImportActionRequest
  | ApplyImportActionRequest;

interface ImportPreview {
  totalSkills: number;
  totalMcpServers: number;
  newSkills: number;
  newMcpServers: number;
  conflictSkills: string[];
  conflictMcpServers: string[];
  invalidSkills: string[];
  invalidMcpServers: string[];
}

interface ImportResult {
  skills: {
    created: number;
    replaced: number;
    renamed: number;
    skipped: number;
    failed: number;
  };
  mcpServers: {
    created: number;
    replaced: number;
    renamed: number;
    skipped: number;
    failed: number;
  };
  messages: string[];
}

interface SanitizedMap {
  map: Record<string, string>;
  redactedKeys: string[];
}

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|authorization|cookie|session|private|credential)/i;
const SENSITIVE_VALUE_PATTERN = /^(bearer|basic|token)\s+/i;
const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function calculateHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getUserSkillsDir(): string {
  return path.join(dataDir, "skills", "user");
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizePlaceholderKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function shouldRedactValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERN.test(value.trim());
}

function isTemplateValue(value: string): boolean {
  const trimmed = value.trim();
  return /^\$\{[A-Z0-9_]+\}$/.test(trimmed);
}

function sanitizeSecretMap(
  input: Record<string, string> | undefined,
  prefix: "ENV" | "HEADER"
): SanitizedMap {
  const source = input ?? {};
  const result: Record<string, string> = {};
  const redactedKeys: string[] = [];

  for (const [key, rawValue] of Object.entries(source)) {
    const value = String(rawValue ?? "");
    const redact = shouldRedactKey(key) || shouldRedactValue(value);
    if (!redact || isTemplateValue(value)) {
      result[key] = value;
      continue;
    }

    const placeholderKey = normalizePlaceholderKey(key) || "VALUE";
    result[key] = `\${${prefix}_${placeholderKey}}`;
    redactedKeys.push(key);
  }

  return { map: result, redactedKeys };
}

function parseMcpArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
}

function parseMcpMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")])
    );
  } catch {
    return {};
  }
}

function normalizeSkillName(name: string): string {
  return name.trim();
}

function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

function ensureUniqueSkillName(baseName: string): string {
  let index = 1;
  let candidate = `${baseName}-import-${index}`;
  while (getSkillByNameAndScope(candidate, "user")) {
    index += 1;
    candidate = `${baseName}-import-${index}`;
  }
  return candidate;
}

function ensureUniqueMcpName(baseName: string): string {
  let index = 1;
  let candidate = `${baseName}-import-${index}`;
  while (getMcpServerByNameAndScope(candidate, "user")) {
    index += 1;
    candidate = `${baseName}-import-${index}`;
  }
  return candidate;
}

function buildSelectionKey(scope: Scope, name: string): string {
  return `${scope}:${name}`;
}

function parseSelectedItems(
  items: Array<{ name: string; scope?: Scope }> | undefined
): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(items)) return set;

  for (const item of items) {
    const name = String(item?.name ?? "").trim();
    if (!name) continue;
    if (item.scope === "builtin" || item.scope === "user") {
      set.add(buildSelectionKey(item.scope, name));
    } else {
      set.add(`*:${name}`);
    }
  }

  return set;
}

function normalizePack(raw: Partial<ExtensionPack>): ExtensionPack {
  const skills = Array.isArray(raw.skills) ? raw.skills : [];
  const mcpServers = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];

  return {
    format: "lumos-extension-pack",
    version: 1,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
    skills: skills.map((item) => ({
      name: String(item.name ?? "").trim(),
      description: String(item.description ?? ""),
      content: String(item.content ?? ""),
      isEnabled: item.isEnabled !== false,
      scope: item.scope === "builtin" ? "builtin" : "user",
    })),
    mcpServers: mcpServers.map((item) => ({
      name: String(item.name ?? "").trim(),
      description: String(item.description ?? ""),
      isEnabled: item.isEnabled !== false,
      scope: item.scope === "builtin" ? "builtin" : "user",
      config: {
        command: String(item.config?.command ?? ""),
        args: Array.isArray(item.config?.args) ? item.config?.args.map((arg) => String(arg)) : [],
        env: item.config?.env && typeof item.config.env === "object"
          ? Object.fromEntries(
              Object.entries(item.config.env).map(([key, value]) => [key, String(value)])
            )
          : {},
        type: item.config?.type,
        url: item.config?.url ? String(item.config.url) : undefined,
        headers: item.config?.headers && typeof item.config.headers === "object"
          ? Object.fromEntries(
              Object.entries(item.config.headers).map(([key, value]) => [key, String(value)])
            )
          : {},
        description: item.config?.description ? String(item.config.description) : undefined,
      },
    })),
    metadata: {
      redactedEnvKeys: Array.isArray(raw.metadata?.redactedEnvKeys)
        ? raw.metadata?.redactedEnvKeys.map((key) => String(key))
        : [],
      redactedHeaderKeys: Array.isArray(raw.metadata?.redactedHeaderKeys)
        ? raw.metadata?.redactedHeaderKeys.map((key) => String(key))
        : [],
    },
  };
}

function validatePackMetadata(raw: Partial<ExtensionPack>): string | null {
  if (raw.format !== "lumos-extension-pack") {
    return "Invalid pack format";
  }
  if (raw.version !== 1) {
    return `Unsupported pack version: ${String(raw.version ?? "unknown")}`;
  }
  return null;
}

async function handleExport(body: ExportActionRequest): Promise<NextResponse> {
  const mode = body.options?.mode === "selected" ? "selected" : "all";
  const includeSkills = body.options?.includeSkills !== false;
  const includeMcpServers = body.options?.includeMcpServers !== false;
  const includeBuiltin = body.options?.includeBuiltin === true;
  const includeDisabled = body.options?.includeDisabled !== false;
  const selectedSkillKeys = parseSelectedItems(body.options?.selectedSkills);
  const selectedMcpKeys = parseSelectedItems(body.options?.selectedMcpServers);

  const scopeFilter = (scope: Scope): boolean => includeBuiltin || scope === "user";

  const exportSkills: SkillPackItem[] = [];
  const exportMcpServers: McpPackItem[] = [];
  const redactedEnvSet = new Set<string>();
  const redactedHeaderSet = new Set<string>();

  if (includeSkills) {
    const skillRecords = getAllSkills();
    for (const record of skillRecords) {
      const enabled = record.is_enabled === 1;
      if (!scopeFilter(record.scope)) continue;
      if (!includeDisabled && !enabled) continue;
      if (mode === "selected") {
        const exactKey = buildSelectionKey(record.scope, record.name);
        if (!selectedSkillKeys.has(exactKey) && !selectedSkillKeys.has(`*:${record.name}`)) {
          continue;
        }
      }

      let content = "";
      if (fs.existsSync(record.file_path)) {
        content = fs.readFileSync(record.file_path, "utf-8");
      }

      exportSkills.push({
        name: record.name,
        description: record.description,
        content,
        isEnabled: enabled,
        scope: record.scope,
      });
    }
  }

  if (includeMcpServers) {
    const serverRecords = getAllMcpServers();
    for (const record of serverRecords) {
      const enabled = record.is_enabled === 1;
      if (!scopeFilter(record.scope)) continue;
      if (!includeDisabled && !enabled) continue;
      if (mode === "selected") {
        const exactKey = buildSelectionKey(record.scope, record.name);
        if (!selectedMcpKeys.has(exactKey) && !selectedMcpKeys.has(`*:${record.name}`)) {
          continue;
        }
      }

      const env = parseMcpMap(record.env);
      const headers = parseMcpMap(record.headers);
      const sanitizedEnv = sanitizeSecretMap(env, "ENV");
      const sanitizedHeaders = sanitizeSecretMap(headers, "HEADER");

      for (const key of sanitizedEnv.redactedKeys) redactedEnvSet.add(key);
      for (const key of sanitizedHeaders.redactedKeys) redactedHeaderSet.add(key);

      exportMcpServers.push({
        name: record.name,
        description: record.description || "",
        isEnabled: enabled,
        scope: record.scope,
        config: {
          command: record.command || "",
          args: parseMcpArray(record.args),
          env: sanitizedEnv.map,
          type: (record.type as "stdio" | "sse" | "http") || "stdio",
          url: record.url || undefined,
          headers: sanitizedHeaders.map,
          description: record.description || undefined,
        },
      });
    }
  }

  const pack: ExtensionPack = {
    format: "lumos-extension-pack",
    version: 1,
    generatedAt: new Date().toISOString(),
    skills: exportSkills,
    mcpServers: exportMcpServers,
    metadata: {
      redactedEnvKeys: Array.from(redactedEnvSet).sort(),
      redactedHeaderKeys: Array.from(redactedHeaderSet).sort(),
    },
  };

  return NextResponse.json({
    success: true,
    pack,
    summary: {
      skills: exportSkills.length,
      mcpServers: exportMcpServers.length,
      redactedEnvKeys: pack.metadata.redactedEnvKeys.length,
      redactedHeaderKeys: pack.metadata.redactedHeaderKeys.length,
    },
  });
}

async function handlePreviewImport(body: PreviewImportActionRequest): Promise<NextResponse> {
  const metadataError = validatePackMetadata(body.pack || {});
  if (metadataError) {
    return NextResponse.json({ error: metadataError }, { status: 400 });
  }

  const pack = normalizePack(body.pack);

  const preview: ImportPreview = {
    totalSkills: pack.skills.length,
    totalMcpServers: pack.mcpServers.length,
    newSkills: 0,
    newMcpServers: 0,
    conflictSkills: [],
    conflictMcpServers: [],
    invalidSkills: [],
    invalidMcpServers: [],
  };

  for (const skill of pack.skills) {
    const name = normalizeSkillName(skill.name);
    if (!name || !isValidSkillName(name)) {
      preview.invalidSkills.push(skill.name || "(empty)");
      continue;
    }

    const existing = getSkillByNameAndScope(name, "user");
    if (existing) {
      preview.conflictSkills.push(name);
    } else {
      preview.newSkills += 1;
    }
  }

  for (const server of pack.mcpServers) {
    const name = server.name.trim();
    if (!name) {
      preview.invalidMcpServers.push("(empty)");
      continue;
    }

    const existing = getMcpServerByNameAndScope(name, "user");
    if (existing) {
      preview.conflictMcpServers.push(name);
    } else {
      preview.newMcpServers += 1;
    }
  }

  return NextResponse.json({
    success: true,
    preview,
  });
}

async function handleApplyImport(body: ApplyImportActionRequest): Promise<NextResponse> {
  const metadataError = validatePackMetadata(body.pack || {});
  if (metadataError) {
    return NextResponse.json({ error: metadataError }, { status: 400 });
  }

  const pack = normalizePack(body.pack);
  const strategy: ConflictStrategy = body.conflictStrategy || "rename";

  const result: ImportResult = {
    skills: {
      created: 0,
      replaced: 0,
      renamed: 0,
      skipped: 0,
      failed: 0,
    },
    mcpServers: {
      created: 0,
      replaced: 0,
      renamed: 0,
      skipped: 0,
      failed: 0,
    },
    messages: [],
  };

  ensureDir(getUserSkillsDir());

  for (const skill of pack.skills) {
    try {
      const normalizedName = normalizeSkillName(skill.name);
      if (!normalizedName || !isValidSkillName(normalizedName)) {
        result.skills.failed += 1;
        result.messages.push(`Invalid skill name: ${skill.name || "(empty)"}`);
        continue;
      }

      const existing = getSkillByNameAndScope(normalizedName, "user");
      let targetName = normalizedName;

      if (existing && strategy === "skip") {
        result.skills.skipped += 1;
        continue;
      }
      if (existing && strategy === "rename") {
        targetName = ensureUniqueSkillName(normalizedName);
      }

      const content = skill.content ?? "";
      const description = skill.description || `Skill: ${targetName}`;
      const contentHash = calculateHash(content);
      const enabled = skill.isEnabled !== false;

      if (existing && strategy === "replace") {
        fs.writeFileSync(existing.file_path, content, "utf-8");
        updateSkill(existing.id, {
          description,
          content_hash: contentHash,
          is_enabled: enabled,
        });
        result.skills.replaced += 1;
        continue;
      }

      const filePath = path.join(getUserSkillsDir(), `${targetName}.md`);
      fs.writeFileSync(filePath, content, "utf-8");
      createSkill({
        name: targetName,
        scope: "user",
        description,
        file_path: filePath,
        content_hash: contentHash,
        is_enabled: enabled,
      });

      if (existing && strategy === "rename") {
        result.skills.renamed += 1;
        result.messages.push(`Skill "${normalizedName}" imported as "${targetName}"`);
      } else {
        result.skills.created += 1;
      }
    } catch (error) {
      result.skills.failed += 1;
      result.messages.push(
        `Failed to import skill "${skill.name}": ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  for (const server of pack.mcpServers) {
    try {
      const normalizedName = server.name.trim();
      if (!normalizedName) {
        result.mcpServers.failed += 1;
        result.messages.push("Invalid MCP server name: (empty)");
        continue;
      }

      const existing = getMcpServerByNameAndScope(normalizedName, "user");
      let targetName = normalizedName;

      if (existing && strategy === "skip") {
        result.mcpServers.skipped += 1;
        continue;
      }
      if (existing && strategy === "rename") {
        targetName = ensureUniqueMcpName(normalizedName);
      }

      const command = server.config.command || "";
      const args = Array.isArray(server.config.args) ? server.config.args.map((arg) => String(arg)) : [];
      const env = server.config.env && typeof server.config.env === "object"
        ? Object.fromEntries(Object.entries(server.config.env).map(([key, value]) => [key, String(value)]))
        : {};
      const headers = server.config.headers && typeof server.config.headers === "object"
        ? Object.fromEntries(Object.entries(server.config.headers).map(([key, value]) => [key, String(value)]))
        : {};
      const type = server.config.type || "stdio";
      const url = server.config.url || "";
      const description = server.description || server.config.description || `MCP server: ${targetName}`;
      const enabled = server.isEnabled !== false;

      if (existing && strategy === "replace") {
        updateMcpServer(existing.id, {
          command,
          args,
          env,
          type,
          url,
          headers,
          description,
          is_enabled: enabled,
        });
        result.mcpServers.replaced += 1;
        continue;
      }

      createMcpServer({
        name: targetName,
        scope: "user",
        command,
        args,
        env,
        type,
        url,
        headers,
        description,
        is_enabled: enabled,
        source: "manual",
      });

      if (existing && strategy === "rename") {
        result.mcpServers.renamed += 1;
        result.messages.push(`MCP server "${normalizedName}" imported as "${targetName}"`);
      } else {
        result.mcpServers.created += 1;
      }
    } catch (error) {
      result.mcpServers.failed += 1;
      result.messages.push(
        `Failed to import MCP server "${server.name}": ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  return NextResponse.json({
    success: true,
    result,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ActionRequest;

    if (!body || typeof body !== "object" || !("action" in body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (body.action === "export") {
      return handleExport(body);
    }
    if (body.action === "preview-import") {
      return handlePreviewImport(body);
    }
    if (body.action === "apply-import") {
      return handleApplyImport(body);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process extension pack request",
      },
      { status: 500 }
    );
  }
}
