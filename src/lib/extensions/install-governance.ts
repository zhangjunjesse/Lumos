import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { dataDir } from '@/lib/db/connection';
import {
  deleteMcpServer,
  deleteSkill,
  getMcpServerByNameAndScope,
  getSkillByNameAndScope,
  parseMcpStringArray,
  parseMcpStringMap,
  updateMcpServer,
  updateSkill,
} from '@/lib/db';
import type { McpServerRecord } from '@/lib/db/mcp-servers';
import type { SkillRecord } from '@/lib/db/skills';
import { recordMemoryV2CapabilityEvent } from '@/lib/memory-v2/capability-events';
import {
  precheckGeneratedCapabilityInstall,
  type CapabilityInstallPrecheckItemInput,
  type CapabilityInstallPrecheckResult,
} from '@/lib/memory-v2/capability-lab';
import type { MCPServerConfig } from '@/types';

export type ExtensionConflictStrategy = 'skip' | 'replace' | 'rename';

export interface ExtensionGovernanceSkillInput {
  name: string;
  description?: string;
  content: string;
}

export interface ExtensionGovernanceMcpInput {
  name: string;
  description?: string;
  config: MCPServerConfig;
  scriptContent?: string;
  pythonPackages?: string[];
}

export interface ExtensionInstallBackup {
  id: string;
  rootPath: string;
  createdAt: string;
  source: string;
  skills: Array<{
    name: string;
    existed: boolean;
    record?: SkillRecord;
    content?: string;
  }>;
  mcpServers: Array<{
    name: string;
    existed: boolean;
    record?: McpServerRecord;
    scriptPath?: string;
    scriptExisted?: boolean;
    scriptContent?: string;
  }>;
}

export interface ExtensionRollbackMutation {
  createdSkills?: string[];
  createdMcpServers?: string[];
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeText(value: unknown, max = 2000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function backupRoot(): string {
  return path.join(dataDir, 'capability-lab', 'install-backups');
}

function isSensitiveConfigKey(key: string): boolean {
  return /(token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|private|credential|密钥|密码|令牌|登录态)/i.test(key);
}

function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed
    || /^\$\{[A-Z0-9_]+\}$/.test(trimmed)
    || /^\[[A-Z0-9_]+\](?:[\\/].*)?$/.test(trimmed);
}

function hasSensitiveLiteralValue(value: string): boolean {
  return /\b(sk-[A-Za-z0-9_-]{12,})\b|\b(Bearer\s+[A-Za-z0-9._-]{12,})\b|\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/i.test(value);
}

function configSecretSignals(input: Record<string, string> | undefined, label: 'env' | 'header'): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input || {})) {
    const value = String(raw ?? '');
    if (!value.trim()) {
      result[key] = 'empty';
    } else if (isPlaceholderValue(value)) {
      result[key] = 'placeholder';
    } else if (isSensitiveConfigKey(key) || hasSensitiveLiteralValue(value)) {
      result[key] = `${label} ${key} api_key: hardcoded_secret_detected`;
    } else {
      result[key] = 'literal_non_secret_value_present';
    }
  }
  return result;
}

function mcpScriptPath(name: string): string {
  return path.join(dataDir, 'mcp-scripts', `${safeName(name)}.py`);
}

function redactMcpRecord(record: McpServerRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name,
    scope: record.scope,
    type: record.type,
    runMode: record.run_mode,
    runtime: record.runtime_kind,
    command: record.command,
    args: parseMcpStringArray(record.args),
    envKeys: Object.keys(parseMcpStringMap(record.env)),
    url: record.url,
    headerKeys: Object.keys(parseMcpStringMap(record.headers)),
    source: record.source,
    contentHash: record.content_hash,
    description: record.description,
    isEnabled: record.is_enabled === 1,
  };
}

function mcpConfigToFile(name: string, mcp: ExtensionGovernanceMcpInput): string {
  const config = mcp.config || {};
  return JSON.stringify({
    name,
    description: mcp.description || config.description || '',
    config: {
      type: config.type || 'stdio',
      runMode: config.runMode || 'on_demand',
      runtime: config.runtime || 'auto',
      command: config.command || '',
      args: config.args || [],
      envKeys: Object.keys(config.env || {}),
      envSecretSignals: configSecretSignals(config.env, 'env'),
      url: config.url || '',
      headerKeys: Object.keys(config.headers || {}),
      headerSecretSignals: configSecretSignals(config.headers, 'header'),
    },
    pythonPackages: mcp.pythonPackages || [],
    hasScriptContent: Boolean(mcp.scriptContent),
  }, null, 2);
}

export function buildCapabilityInstallPrecheckItems(input: {
  skills?: ExtensionGovernanceSkillInput[];
  mcpServers?: ExtensionGovernanceMcpInput[];
  source?: string;
}): CapabilityInstallPrecheckItemInput[] {
  const items: CapabilityInstallPrecheckItemInput[] = [];
  for (const skill of input.skills || []) {
    const name = normalizeText(skill.name, 120);
    const content = String(skill.content ?? '');
    if (!name || !content) continue;
    items.push({
      capabilityType: 'skill',
      capabilityName: name,
      version: hashText(content),
      files: [{
        path: 'SKILL.md',
        content,
      }],
      metadata: {
        source: input.source || 'extension-install',
        permissions: ['Skill 只注入 Markdown 指令，不具备代码执行权限。'],
        selfTests: ['检查 Skill 名称、描述、Markdown frontmatter 和内容哈希。'],
      },
    });
  }

  for (const mcp of input.mcpServers || []) {
    const name = normalizeText(mcp.name, 120);
    if (!name) continue;
    const files = [{
      path: 'mcp-config.json',
      content: mcpConfigToFile(name, mcp),
    }];
    if (mcp.scriptContent) {
      files.push({
        path: `server-${safeName(name)}.py`,
        content: mcp.scriptContent,
      });
    }
    if (mcp.pythonPackages && mcp.pythonPackages.length > 0) {
      files.push({
        path: 'requirements.txt',
        content: mcp.pythonPackages.join('\n'),
      });
    }
    items.push({
      capabilityType: 'mcp',
      capabilityName: name,
      version: hashText(files.map((file) => `${file.path}\n${file.content}`).join('\n---\n')),
      files,
      metadata: {
        source: input.source || 'extension-install',
        permissions: [
          `MCP transport: ${mcp.config?.type || 'stdio'}`,
          `MCP runtime: ${mcp.config?.runtime || 'auto'}`,
          mcp.config?.url ? `Remote URL: ${mcp.config.url}` : 'Local stdio process only if command is declared.',
        ],
        selfTests: ['安装后执行 MCP initialize、notifications/initialized、tools/list 协议自检。'],
      },
    });
  }
  return items;
}

export function runExtensionInstallPrecheck(input: {
  source: string;
  skills?: ExtensionGovernanceSkillInput[];
  mcpServers?: ExtensionGovernanceMcpInput[];
}): CapabilityInstallPrecheckResult {
  return precheckGeneratedCapabilityInstall({
    source: input.source,
    items: buildCapabilityInstallPrecheckItems(input),
  });
}

export function createExtensionInstallBackup(input: {
  source: string;
  skills?: ExtensionGovernanceSkillInput[];
  mcpServers?: ExtensionGovernanceMcpInput[];
}): ExtensionInstallBackup {
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
  const rootPath = path.join(backupRoot(), id);
  fs.mkdirSync(rootPath, { recursive: true });
  const backup: ExtensionInstallBackup = {
    id,
    rootPath,
    createdAt: nowSql(),
    source: input.source,
    skills: [],
    mcpServers: [],
  };

  for (const skill of input.skills || []) {
    const name = normalizeText(skill.name, 120);
    if (!name) continue;
    const existing = getSkillByNameAndScope(name, 'user');
    const content = existing?.file_path && fs.existsSync(existing.file_path)
      ? fs.readFileSync(existing.file_path, 'utf8')
      : '';
    backup.skills.push({
      name,
      existed: Boolean(existing),
      ...(existing ? { record: existing, content } : {}),
    });
    if (existing) {
      recordMemoryV2CapabilityEvent({
        capabilityType: 'skill',
        capabilityName: name,
        scope: 'install-backup',
        action: 'version_snapshot_created',
        status: 'success',
        source: input.source,
        summary: '安装或更新前已创建 Skill 旧版本快照。',
        relatedId: existing.id,
        version: existing.content_hash,
        metadata: { backupId: id, backupRoot: rootPath },
      });
    }
  }

  for (const mcp of input.mcpServers || []) {
    const name = normalizeText(mcp.name, 120);
    if (!name) continue;
    const existing = getMcpServerByNameAndScope(name, 'user');
    const scriptPath = mcp.scriptContent ? mcpScriptPath(name) : '';
    const scriptExisted = Boolean(scriptPath && fs.existsSync(scriptPath));
    const scriptContent = scriptExisted ? fs.readFileSync(scriptPath, 'utf8') : '';
    backup.mcpServers.push({
      name,
      existed: Boolean(existing),
      ...(existing ? { record: existing } : {}),
      ...(scriptPath ? { scriptPath, scriptExisted, scriptContent } : {}),
    });
    if (existing) {
      recordMemoryV2CapabilityEvent({
        capabilityType: 'mcp',
        capabilityName: name,
        scope: 'install-backup',
        action: 'version_snapshot_created',
        status: 'success',
        source: input.source,
        summary: '安装或更新前已创建 MCP 旧版本快照。',
        relatedId: existing.id,
        version: existing.content_hash,
        metadata: { backupId: id, backupRoot: rootPath, record: redactMcpRecord(existing) },
      });
    }
  }

  fs.writeFileSync(path.join(rootPath, 'manifest.json'), JSON.stringify({
    id: backup.id,
    createdAt: backup.createdAt,
    source: backup.source,
    skills: backup.skills.map((item) => ({
      name: item.name,
      existed: item.existed,
      record: item.record ? {
        id: item.record.id,
        filePath: item.record.file_path,
        contentHash: item.record.content_hash,
        description: item.record.description,
        isEnabled: item.record.is_enabled === 1,
      } : null,
      contentHash: item.content ? hashText(item.content) : '',
    })),
    mcpServers: backup.mcpServers.map((item) => ({
      name: item.name,
      existed: item.existed,
      record: item.record ? redactMcpRecord(item.record) : null,
      scriptPath: item.scriptPath || '',
      scriptExisted: Boolean(item.scriptExisted),
      scriptContentHash: item.scriptContent ? hashText(item.scriptContent) : '',
    })),
  }, null, 2), 'utf8');

  return backup;
}

export function rollbackExtensionInstallBackup(
  backup: ExtensionInstallBackup,
  mutation: ExtensionRollbackMutation = {},
): string[] {
  const messages: string[] = [];
  for (const name of mutation.createdSkills || []) {
    const current = getSkillByNameAndScope(name, 'user');
    if (current) {
      if (current.file_path && fs.existsSync(current.file_path)) {
        fs.rmSync(current.file_path, { force: true });
      }
      deleteSkill(current.id);
      messages.push(`已删除本次新建 Skill：${name}`);
    }
  }

  for (const name of mutation.createdMcpServers || []) {
    const current = getMcpServerByNameAndScope(name, 'user');
    if (current) {
      deleteMcpServer(current.id);
      messages.push(`已删除本次新建 MCP：${name}`);
    }
  }

  for (const item of backup.skills) {
    if (!item.existed || !item.record) continue;
    if (item.content !== undefined) {
      fs.mkdirSync(path.dirname(item.record.file_path), { recursive: true });
      fs.writeFileSync(item.record.file_path, item.content, 'utf8');
    }
    updateSkill(item.record.id, {
      description: item.record.description,
      file_path: item.record.file_path,
      content_hash: item.record.content_hash,
      is_enabled: item.record.is_enabled === 1,
    });
    recordMemoryV2CapabilityEvent({
      capabilityType: 'skill',
      capabilityName: item.name,
      scope: 'install-rollback',
      action: 'install_rolled_back',
      status: 'success',
      source: backup.source,
      summary: '安装失败后已恢复 Skill 旧版本。',
      relatedId: item.record.id,
      version: item.record.content_hash,
      metadata: { backupId: backup.id, backupRoot: backup.rootPath },
    });
    messages.push(`已恢复 Skill：${item.name}`);
  }

  for (const item of backup.mcpServers) {
    if (item.scriptPath) {
      if (item.scriptExisted) {
        fs.mkdirSync(path.dirname(item.scriptPath), { recursive: true });
        fs.writeFileSync(item.scriptPath, item.scriptContent || '', 'utf8');
        fs.chmodSync(item.scriptPath, 0o755);
        messages.push(`已恢复 MCP 脚本：${item.name}`);
      } else if (fs.existsSync(item.scriptPath)) {
        fs.rmSync(item.scriptPath, { force: true });
        messages.push(`已删除本次新建 MCP 脚本：${item.name}`);
      }
    }
    if (!item.existed || !item.record) continue;
    updateMcpServer(item.record.id, {
      command: item.record.command,
      args: parseMcpStringArray(item.record.args),
      env: parseMcpStringMap(item.record.env),
      type: item.record.type,
      runMode: item.record.run_mode,
      runtime: item.record.runtime_kind,
      url: item.record.url,
      headers: parseMcpStringMap(item.record.headers),
      is_enabled: item.record.is_enabled === 1,
      description: item.record.description,
      source: item.record.source,
      content_hash: item.record.content_hash,
    });
    recordMemoryV2CapabilityEvent({
      capabilityType: 'mcp',
      capabilityName: item.name,
      scope: 'install-rollback',
      action: 'install_rolled_back',
      status: 'success',
      source: backup.source,
      summary: '安装失败后已恢复 MCP 旧版本。',
      relatedId: item.record.id,
      version: item.record.content_hash,
      metadata: { backupId: backup.id, backupRoot: backup.rootPath, record: redactMcpRecord(item.record) },
    });
    messages.push(`已恢复 MCP：${item.name}`);
  }

  return messages;
}
