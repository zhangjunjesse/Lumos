import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import type { MCPServerConfig } from '@/types';
import {
  createMcpServer,
  createSkill,
  getMcpServerByNameAndScope,
  getSkillByNameAndScope,
  updateMcpServer,
  updateMcpServerHealth,
  updateSkill,
} from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import { normalizePortableMcpConfig, normalizePortableMcpMap, normalizePortableMcpValue } from '@/lib/mcp-config-placeholders';
import { ensureVenv, installPackage, listPackages, uninstallPackage } from '@/lib/python-venv';
import { smokeTestMcpServerConfig, type McpSmokeTestResult } from '@/lib/mcp-smoke-test';
import {
  createExtensionInstallBackup,
  rollbackExtensionInstallBackup,
  runExtensionInstallPrecheck,
  type ExtensionGovernanceMcpInput,
  type ExtensionGovernanceSkillInput,
  type ExtensionRollbackMutation,
} from '@/lib/extensions/install-governance';

export const runtime = 'nodejs';

type ApplyStatus = 'created' | 'updated' | 'error' | 'invalid';

interface ExtensionPlanSkill {
  name?: string;
  description?: string;
  content?: string;
}

interface ExtensionPlanMcp {
  name?: string;
  description?: string;
  config?: MCPServerConfig;
  pythonPackages?: string[];
  scriptContent?: string;
}

interface ExtensionPlan {
  type?: string;
  summary?: string;
  skills?: ExtensionPlanSkill[];
  mcpServers?: ExtensionPlanMcp[];
}

const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SCRIPTS_DIR = path.join(dataDir, 'mcp-scripts');

function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function portableContext() {
  return { dataDir, homeDir: process.env.HOME || process.env.USERPROFILE || '' };
}

function safeScriptName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getUserSkillsDir(): string {
  return path.join(dataDir, 'skills', 'user');
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function normalizePlan(raw: unknown): {
  skills: ExtensionGovernanceSkillInput[];
  mcpServers: ExtensionGovernanceMcpInput[];
} {
  const plan = (raw && typeof raw === 'object' ? raw : {}) as ExtensionPlan;
  const skills = Array.isArray(plan.skills) ? plan.skills : [];
  const mcpServers = Array.isArray(plan.mcpServers) ? plan.mcpServers : [];
  return {
    skills: skills.map((skill) => ({
      name: String(skill.name || '').trim(),
      description: String(skill.description || ''),
      content: String(skill.content || ''),
    })),
    mcpServers: mcpServers.map((server) => {
      const config: MCPServerConfig = server.config || { command: '' };
      const hasPythonScript = typeof server.scriptContent === 'string' && server.scriptContent.trim().length > 0;
      const normalized: MCPServerConfig = normalizePortableMcpConfig({
        command: hasPythonScript
          ? normalizePortableMcpValue(config.command || '[PYTHON_PATH]', portableContext())
          : normalizePortableMcpValue(config.command || '', portableContext()),
        args: Array.isArray(config.args)
          ? config.args.map((arg) => normalizePortableMcpValue(String(arg), portableContext()))
          : hasPythonScript
            ? [`[DATA_DIR]/mcp-scripts/${safeScriptName(String(server.name || '').trim())}.py`]
            : [],
        env: config.env && typeof config.env === 'object'
          ? normalizePortableMcpMap(
              Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, String(value)])),
              portableContext(),
            )
          : {},
        type: config.type || 'stdio',
        runMode: config.runMode || 'on_demand',
        runtime: config.runtime || (hasPythonScript ? 'python' : 'auto'),
        url: config.url ? normalizePortableMcpValue(String(config.url), portableContext()) : '',
        headers: config.headers && typeof config.headers === 'object'
          ? normalizePortableMcpMap(
              Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, String(value)])),
              portableContext(),
            )
          : {},
        description: server.description || config.description || '',
      }, portableContext());
      return {
        name: String(server.name || '').trim(),
        description: String(server.description || normalized.description || ''),
        config: normalized,
        pythonPackages: Array.isArray(server.pythonPackages)
          ? server.pythonPackages.map((pkg) => String(pkg).trim()).filter(Boolean).slice(0, 40)
          : [],
        scriptContent: typeof server.scriptContent === 'string' ? server.scriptContent : '',
      };
    }),
  };
}

function serializePrecheck(precheck: ReturnType<typeof runExtensionInstallPrecheck>) {
  return {
    governanceId: precheck.governanceId,
    installAllowed: precheck.installAllowed,
    blockedReasons: precheck.blockedReasons,
    missingAcceptance: precheck.missingAcceptance,
    requiredReview: precheck.requiredReview,
    rollbackPlan: precheck.rollbackPlan,
    versionPlan: precheck.versionPlan,
    items: precheck.items.map((item) => ({
      capabilityType: item.capabilityType,
      capabilityName: item.capabilityName,
      versionHash: item.versionHash,
      scan: {
        verdict: item.scan.verdict,
        riskLevel: item.scan.riskLevel,
        policy: item.scan.policy,
        findings: item.scan.findings.slice(0, 20),
      },
    })),
  };
}

function healthFromResult(result: McpSmokeTestResult) {
  const health = {
    status: result.ok ? (result.skipped ? 'skipped' as const : 'ok' as const) : 'failed' as const,
    checked_at: new Date().toISOString(),
    error: result.ok ? '' : (result.error || 'MCP smoke test failed'),
    message: result.reason || '',
    tools: Array.isArray(result.tools) ? result.tools : [],
  };
  return result.transport ? { ...health, transport: result.transport } : health;
}

function packageName(raw: string): string {
  return raw.trim().split(/[<>=!~\[]/, 1)[0].toLowerCase();
}

function installedPackageNames(packages: string[]): Set<string> {
  return new Set(packages.map((item) => packageName(item)).filter(Boolean));
}

async function bestEffortUninstall(packages: string[]): Promise<string[]> {
  const messages: string[] = [];
  for (const pkg of packages) {
    try {
      await uninstallPackage(pkg);
      messages.push(`已卸载本次新增 Python 包：${pkg}`);
    } catch (error) {
      messages.push(`Python 包 ${pkg} 回滚失败：${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return messages;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const rawPlan = body?.plan || body;
  const planType = rawPlan?.type ? String(rawPlan.type) : 'lumos-extension-plan';
  if (planType !== 'lumos-extension-plan') {
    return NextResponse.json({ error: 'Invalid extension plan type' }, { status: 400 });
  }

  const plan = normalizePlan(rawPlan);
  if (plan.skills.length + plan.mcpServers.length === 0) {
    return NextResponse.json({ error: 'Extension plan is empty' }, { status: 400 });
  }

  const precheck = runExtensionInstallPrecheck({
    source: 'extension-builder-plan',
    skills: plan.skills,
    mcpServers: plan.mcpServers,
  });
  const serializedPrecheck = serializePrecheck(precheck);
  if (!precheck.installAllowed) {
    return NextResponse.json({
      error: '安装前预检未通过，已阻止安装。请先让能力生成器修复或二开重写。',
      precheck: serializedPrecheck,
    }, { status: 422 });
  }

  const backup = createExtensionInstallBackup({
    source: 'extension-builder-plan',
    skills: plan.skills,
    mcpServers: plan.mcpServers,
  });
  const mutation: ExtensionRollbackMutation = { createdSkills: [], createdMcpServers: [] };
  const result: {
    skills: Array<{ name: string; status: ApplyStatus; message?: string }>;
    mcps: Array<{ name: string; status: ApplyStatus; message?: string }>;
    messages: string[];
    backupId: string;
    rollbackMessages?: string[];
  } = {
    skills: [],
    mcps: [],
    messages: [],
    backupId: backup.id,
  };
  const newlyInstalledPackages: string[] = [];

  try {
    ensureDir(getUserSkillsDir());

    for (const skill of plan.skills) {
      const name = skill.name.trim();
      const content = skill.content;
      if (!name || !SKILL_NAME_PATTERN.test(name) || !content) {
        result.skills.push({ name: name || '(empty)', status: 'invalid', message: 'Invalid skill name or content' });
        throw new Error(`Invalid skill: ${name || '(empty)'}`);
      }
      const description = skill.description || `Skill: ${name}`;
      const contentHash = calculateHash(content);
      const existing = getSkillByNameAndScope(name, 'user');
      if (existing) {
        fs.writeFileSync(existing.file_path, content, 'utf8');
        updateSkill(existing.id, {
          description,
          content_hash: contentHash,
          is_enabled: true,
        });
        result.skills.push({ name, status: 'updated' });
      } else {
        const filePath = path.join(getUserSkillsDir(), `${name}.md`);
        fs.writeFileSync(filePath, content, 'utf8');
        createSkill({
          name,
          scope: 'user',
          description,
          file_path: filePath,
          content_hash: contentHash,
          is_enabled: true,
        });
        mutation.createdSkills?.push(name);
        result.skills.push({ name, status: 'created' });
      }
    }

    const needsPython = plan.mcpServers.some((server) => server.scriptContent || (server.pythonPackages || []).length > 0);
    const packagesBefore = needsPython ? installedPackageNames(await listPackages()) : new Set<string>();
    if (needsPython) await ensureVenv();

    for (const server of plan.mcpServers) {
      const name = server.name.trim();
      if (!name) {
        result.mcps.push({ name: '(empty)', status: 'invalid', message: 'Invalid MCP server name' });
        throw new Error('Invalid MCP server name');
      }
      const config = server.config || {};
      const type = config.type || 'stdio';
      const command = config.command || '';
      const url = config.url || '';
      if (type === 'stdio' && !command) {
        result.mcps.push({ name, status: 'invalid', message: 'Missing stdio command' });
        throw new Error(`MCP ${name} missing stdio command`);
      }
      if ((type === 'sse' || type === 'http') && !url) {
        result.mcps.push({ name, status: 'invalid', message: 'Missing remote URL' });
        throw new Error(`MCP ${name} missing remote URL`);
      }

      if (server.scriptContent) {
        ensureDir(SCRIPTS_DIR);
        const scriptPath = path.join(SCRIPTS_DIR, `${safeScriptName(name)}.py`);
        fs.writeFileSync(scriptPath, server.scriptContent, 'utf8');
        fs.chmodSync(scriptPath, 0o755);
      }

      for (const pkg of server.pythonPackages || []) {
        await installPackage(pkg);
        const baseName = packageName(pkg);
        if (baseName && !packagesBefore.has(baseName)) newlyInstalledPackages.push(pkg);
      }

      const contentHash = calculateHash(JSON.stringify({
        config,
        pythonPackages: server.pythonPackages || [],
        scriptHash: server.scriptContent ? calculateHash(server.scriptContent) : '',
      }));
      const existing = getMcpServerByNameAndScope(name, 'user');
      if (existing) {
        updateMcpServer(existing.id, {
          command: command || '',
          args: config.args || [],
          env: config.env || {},
          type,
          runMode: config.runMode || 'on_demand',
          runtime: config.runtime || 'auto',
          url,
          headers: config.headers || {},
          description: server.description || config.description || `MCP server: ${name}`,
          is_enabled: true,
          source: 'extension-builder-plan',
          content_hash: contentHash,
        });
        result.mcps.push({ name, status: 'updated' });
      } else {
        createMcpServer({
          name,
          scope: 'user',
          command: command || '',
          args: config.args || [],
          env: config.env || {},
          type,
          runMode: config.runMode || 'on_demand',
          runtime: config.runtime || 'auto',
          url,
          headers: config.headers || {},
          description: server.description || config.description || `MCP server: ${name}`,
          is_enabled: true,
          source: 'extension-builder-plan',
          content_hash: contentHash,
        });
        mutation.createdMcpServers?.push(name);
        result.mcps.push({ name, status: 'created' });
      }

      const smoke = await smokeTestMcpServerConfig({
        command: command || '',
        args: config.args || [],
        env: config.env || {},
        type,
        runMode: config.runMode || 'on_demand',
        runtime: config.runtime || 'auto',
        url,
        headers: config.headers || {},
      });
      const installedRecord = getMcpServerByNameAndScope(name, 'user');
      if (installedRecord) updateMcpServerHealth(installedRecord.id, healthFromResult(smoke));
      if (!smoke.ok) {
        const message = smoke.error || smoke.reason || 'MCP smoke test failed';
        const target = result.mcps.find((item) => item.name === name);
        if (target) target.message = `MCP self-test failed: ${message}`;
        throw new Error(`MCP ${name} self-test failed: ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      result,
      precheck: serializedPrecheck,
    });
  } catch (error) {
    const rollbackMessages = rollbackExtensionInstallBackup(backup, mutation);
    rollbackMessages.push(...await bestEffortUninstall(Array.from(new Set(newlyInstalledPackages))));
    result.rollbackMessages = rollbackMessages;
    result.messages.push(...rollbackMessages);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Extension plan install failed',
      result,
      precheck: serializedPrecheck,
    }, { status: 500 });
  }
}
