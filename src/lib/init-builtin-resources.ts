import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import {
  createSkill,
  getDefaultProvider,
  getSkillByNameAndScope,
  getSkillsByScope,
  updateSkill,
  deleteSkill,
  createMcpServer,
  getMcpServerByNameAndScope,
  getMcpServersByScope,
  updateMcpServer,
  deleteMcpServer,
  setSetting,
  getBuiltinProvider,
} from './db';
import { getDb } from './db';
import { seedBuiltinWorkflowAgentPresets } from './db/workflow-agent-presets';
import { resolveProviderPersistenceFields } from './provider-config';
import { buildTemplateBlueprintFiles } from './app/builder/templates';
import type { BuilderSession } from './app/builder/session';
import { ensureGoofishDefaultAutomations } from './app/goofish-default-automations';
import { ensureDouyinDefaultAutomations } from './app/douyin-default-automations';
import { ensureDeepResearchDefaultAutomations } from './app/deep-research-default-automations';
import { installApp } from './app/installer/install';
import { createAppDataStore } from './app/runtime/data-store';
import { buildInstallContext, getAppPlatformService } from './app/service';

const BUILTIN_GOOFISH_APP_ID = 'goofish-assistant';
const BUILTIN_GOOFISH_VERSION = '0.1.0';

const BUILTIN_ECOMMERCE_APP_ID = 'ecommerce-assistant';
const BUILTIN_ECOMMERCE_VERSION = '0.1.0';

const BUILTIN_DOUYIN_COLLECTOR_APP_ID = 'douyin-collector';
const BUILTIN_DOUYIN_COLLECTOR_VERSION = '0.0.5';

const BUILTIN_DEEP_RESEARCH_APP_ID = 'deep-research';
const BUILTIN_DEEP_RESEARCH_VERSION = '0.0.1';

const PLACEHOLDER_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// ==========================================
// Types
// ==========================================

interface SkillMetadata {
  name: string;
  description: string;
}

interface McpServerConfig {
  name: string;
  description: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse' | 'http';
  runMode?: 'on_demand' | 'keep_alive';
  runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
}

// ==========================================
// Helper Functions
// ==========================================

function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get the public directory path.
 * In production (Electron), public files are in extraResources/standalone/public/
 * In development, they're in the project root/public/
 */
function getPublicDir(): string {
  if (process.resourcesPath) {
    const prodPath = path.join(process.resourcesPath, 'standalone', 'public');
    if (fs.existsSync(prodPath)) return prodPath;
  }
  return path.join(process.cwd(), 'public');
}

// ==========================================
// Import Skills
// ==========================================

/**
 * Resolve each skill entry in public/skills/ to an absolute SKILL.md path.
 * Supports two layouts:
 *  - `<skillsDir>/foo.md`  (single-file skill)
 *  - `<skillsDir>/foo/SKILL.md`  (folder skill, may include scripts/assets)
 */
function listSkillFiles(skillsDir: string): string[] {
  const paths: string[] = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(path.join(skillsDir, entry.name));
      continue;
    }
    if (entry.isDirectory()) {
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) paths.push(skillMd);
    }
  }
  return paths;
}

function importSkills(): number {
  const skillsDir = path.join(getPublicDir(), 'skills');

  if (!fs.existsSync(skillsDir)) {
    console.warn('[init-builtin-resources] Skills directory not found:', skillsDir);
    return 0;
  }

  const files = listSkillFiles(skillsDir);
  let imported = 0;
  const currentNames = new Set<string>();

  for (const filePath of files) {
    const file = path.basename(filePath);
    let metadata: SkillMetadata;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      metadata = matter(content).data as SkillMetadata;
    } catch (err) {
      console.warn(`[init-builtin-resources] Skipping skill with malformed frontmatter (${filePath}):`, err instanceof Error ? err.message : err);
      continue;
    }
    if (!metadata.name || !metadata.description) {
      console.warn('[init-builtin-resources] Invalid skill metadata in:', file);
      continue;
    }
    currentNames.add(metadata.name);

    const contentHash = calculateFileHash(filePath);
    const existing = getSkillByNameAndScope(metadata.name, 'builtin');

    if (existing) {
      if (existing.content_hash !== contentHash) {
        updateSkill(existing.id, {
          description: metadata.description,
          file_path: filePath,
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated skill:', metadata.name);
      }
    } else {
      createSkill({
        name: metadata.name,
        scope: 'builtin',
        description: metadata.description,
        file_path: filePath,
        content_hash: contentHash,
        is_enabled: true,
      });
      console.log('[init-builtin-resources] Imported skill:', metadata.name);
      imported++;
    }
  }

  // Remove builtin skills that no longer exist in public/skills
  const existingBuiltin = getSkillsByScope('builtin');
  const removed: string[] = [];
  for (const skill of existingBuiltin) {
    if (!currentNames.has(skill.name)) {
      if (deleteSkill(skill.id)) {
        removed.push(skill.name);
      }
    }
  }
  if (removed.length > 0) {
    console.log(`[init-builtin-resources] Removed builtin skills: ${removed.join(', ')}`);
  }

  return imported;
}

// ==========================================
// Import MCP Servers
// ==========================================

function importMcpServers(): number {
  const mcpDir = path.join(getPublicDir(), 'mcp-servers');

  if (!fs.existsSync(mcpDir)) {
    console.warn('[init-builtin-resources] MCP servers directory not found:', mcpDir);
    return 0;
  }

  const files = fs.readdirSync(mcpDir).filter(f => f.endsWith('.json'));
  let imported = 0;
  const currentNames = new Set<string>();

  for (const file of files) {
    const filePath = path.join(mcpDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as McpServerConfig;

    if (!config.name || !config.command) {
      console.warn('[init-builtin-resources] Invalid MCP config in:', file);
      continue;
    }

    currentNames.add(config.name);

    // Keep placeholders (e.g. [RUNTIME_PATH]) in DB config.
    // They are resolved at request-time in chat route where full context
    // (workspace/data dir) is available.
    const args = config.args || [];
    const contentHash = calculateFileHash(filePath);
    const existing = getMcpServerByNameAndScope(config.name, 'builtin');

    if (existing) {
      if (existing.content_hash !== contentHash) {
        let mergedEnv = config.env || {};
        try {
          const existingEnv = JSON.parse(existing.env || '{}') as Record<string, string>;
          // Preserve user-edited env values on builtin upgrades (e.g. API keys).
          mergedEnv = {
            ...(config.env || {}),
            ...existingEnv,
          };
        } catch {
          // Keep builtin defaults if existing env cannot be parsed
        }
        updateMcpServer(existing.id, {
          description: config.description,
          command: config.command,
          args,
          env: mergedEnv,
          type: config.type || existing.type || 'stdio',
          runMode: config.runMode || existing.run_mode || 'on_demand',
          runtime: config.runtime || existing.runtime_kind || 'auto',
          content_hash: contentHash,
        });
        console.log('[init-builtin-resources] Updated MCP server:', config.name);
      }
    } else {
      // workflow and deepsearch are enabled by default for core orchestration flows
      const isEnabled = config.name === 'workflow'
        || config.name === 'deepsearch'
        || config.name === 'office-docs'
        || config.name === 'speech-to-text'
        || config.name === 'chrome-devtools'
        || config.name === 'image-reader'
        || config.name === 'im-tools'
        // goofish-search reads from the local SQLite archive — works without
        // a live login (returns empty for cold-start users) and is the
        // primary tool the AI uses to inspect goofish state. Always on.
        || config.name === 'goofish-search'
        // x-platform MCP 默认启用:工具在用户未登录时返回 X_AUTH_EXPIRED
        // 友好提示,让 AI 能引导用户去「服务 → X」登录,而不是工具不存在。
        || config.name === 'x-platform'
        // douyin-collector MCP 默认启用:工具在底层未实现时返回 ok:false +
        // 结构化原因,让 AI 能诚实地告知用户「下一轮迭代实现」而不是
        // 假装工具不存在或瞎编结果。
        || config.name === 'douyin-collector';
      // goofish stays disabled by default — its tools call live mtop, which
      // fails with "session expired" until the user logs in via the panel.
      // The auth/login route flips it on automatically on success.
      createMcpServer({
        name: config.name,
        scope: 'builtin',
        description: config.description || '',
        command: config.command,
        args,
        env: config.env,
        type: config.type || 'stdio',
        runMode: config.runMode || 'on_demand',
        runtime: config.runtime || 'auto',
        is_enabled: isEnabled,
        source: 'builtin',
        content_hash: contentHash,
      });
      console.log('[init-builtin-resources] Imported MCP server:', config.name);
      imported++;
    }
  }

  // Remove builtin MCP servers whose JSON config no longer exists (e.g. filesystem was removed).
  const existingBuiltin = getMcpServersByScope('builtin');
  const removed: string[] = [];
  for (const server of existingBuiltin) {
    if (!currentNames.has(server.name)) {
      if (deleteMcpServer(server.id)) removed.push(server.name);
    }
  }
  if (removed.length > 0) {
    console.log(`[init-builtin-resources] Removed builtin MCP servers: ${removed.join(', ')}`);
  }

  return imported;
}

// ==========================================
// Import Built-in Providers
// ==========================================

function importProviders(): void {
  const existing = getBuiltinProvider();
  if (existing) return;

  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const fields = resolveProviderPersistenceFields({
    providerType: 'anthropic',
    capabilities: ['agent-chat'],
    providerOrigin: 'system',
    authMode: 'api_key',
    isBuiltin: 1,
  });

  const resolvedDefaultProvider = getDefaultProvider();
  const shouldBecomeDefaultProvider = !resolvedDefaultProvider;
  const isActive = shouldBecomeDefaultProvider ? 1 : 0;

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, api_protocol, capabilities, provider_origin, auth_mode, base_url, api_key, is_active, sort_order, extra_env, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    'Anthropic (Built-in)',
    fields.providerType,
    fields.apiProtocol,
    fields.capabilities,
    fields.providerOrigin,
    fields.authMode,
    '',
    '',
    isActive,
    0,
    '{}',
    'Built-in provider. Fill in your API key to activate.',
    1,
    0,
    now,
    now,
  );

  if (shouldBecomeDefaultProvider) {
    setSetting('default_provider_id', id);
  }

  console.log(
    `[init-builtin-resources] Created built-in Anthropic provider (default=${shouldBecomeDefaultProvider}, is_active=${isActive})`,
  );
}

// ==========================================
// Built-in Apps
// ==========================================

async function ensureEcommerceAssistantInstalled(): Promise<void> {
  const svc = getAppPlatformService();
  const existing = svc.db
    .prepare('SELECT id, version FROM lumos_app_apps WHERE id = ?')
    .get(BUILTIN_ECOMMERCE_APP_ID) as { id: string; version: string } | undefined;

  if (existing && existing.version === BUILTIN_ECOMMERCE_VERSION) {
    seedBuiltinPresets();
    return;
  }

  const now = Date.now();
  const session: BuilderSession = {
    id: 'bs_builtin_ecommerce',
    status: 'installed',
    appId: BUILTIN_ECOMMERCE_APP_ID,
    appName: '电商商品助手',
    appDescription:
      '一键生成电商商品图、识别商品资料、批量出图、风格预设和场景方向调整的内置应用。',
    templateId: 'ecommerce-assistant',
    createdAt: now,
    updatedAt: now,
  };

  const files = buildTemplateBlueprintFiles(session, 'ecommerce-assistant', { now });
  if (!files) {
    console.warn('[init-builtin-resources] ecommerce-assistant template returned null');
    return;
  }

  const appJson = JSON.parse(files['app.json']);
  appJson.id = BUILTIN_ECOMMERCE_APP_ID;
  appJson.version = BUILTIN_ECOMMERCE_VERSION;
  files['app.json'] = `${JSON.stringify(appJson, null, 2)}\n`;

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-ecommerce-builtin-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(stagingDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    fs.writeFileSync(
      path.join(stagingDir, 'icon.png'),
      Buffer.from(PLACEHOLDER_ICON_PNG_BASE64, 'base64'),
    );

    const ctx = buildInstallContext(async (req) => ({
      granted: req.permissions.map((p) => p.permission),
    }));

    const result = await installApp(
      { type: 'directory', path: stagingDir },
      ctx,
      { source: 'local' },
    );

    if (result.ok) {
      const tag = existing
        ? `升级 ${existing.version} → ${BUILTIN_ECOMMERCE_VERSION}`
        : `首次安装 ${BUILTIN_ECOMMERCE_VERSION}`;
      seedBuiltinPresets();
      console.log(`[init-builtin-resources] ecommerce-assistant ${tag}`);
    } else {
      console.warn(
        `[init-builtin-resources] ecommerce-assistant install failed: ${result.message}`,
      );
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function seedBuiltinPresets(): void {
  try {
    const svc = getAppPlatformService();
    const store = createAppDataStore(svc.db, BUILTIN_ECOMMERCE_APP_ID);
    // Lazy import to avoid circular deps; ensures builtin presets exist post-install.
    void import('./ecommerce-assistant/storage').then(({ ensureBuiltinStylePresets }) => {
      ensureBuiltinStylePresets(store);
    });
  } catch (err) {
    console.warn('[init-builtin-resources] ecommerce-assistant preset seeding failed:', err);
  }
}

async function ensureGoofishAssistantInstalled(): Promise<void> {
  const svc = getAppPlatformService();
  const existing = svc.db
    .prepare('SELECT id, version FROM lumos_app_apps WHERE id = ?')
    .get(BUILTIN_GOOFISH_APP_ID) as { id: string; version: string } | undefined;

  if (existing && existing.version === BUILTIN_GOOFISH_VERSION) {
    ensureGoofishDefaultAutomations(createAppDataStore(svc.db, BUILTIN_GOOFISH_APP_ID));
    return;
  }

  const now = Date.now();
  const session: BuilderSession = {
    id: 'bs_builtin_goofish',
    status: 'installed',
    appId: BUILTIN_GOOFISH_APP_ID,
    appName: '闲鱼助手',
    appDescription:
      '管理闲鱼买家会话、AI 回复草稿、白名单分级自动回复、多渠道提醒、四范围搜索的内置应用。',
    templateId: 'goofish-assistant',
    createdAt: now,
    updatedAt: now,
  };

  const files = buildTemplateBlueprintFiles(session, 'goofish-assistant', { now });
  if (!files) {
    console.warn('[init-builtin-resources] goofish-assistant template returned null');
    return;
  }

  const appJson = JSON.parse(files['app.json']);
  appJson.id = BUILTIN_GOOFISH_APP_ID;
  appJson.version = BUILTIN_GOOFISH_VERSION;
  files['app.json'] = `${JSON.stringify(appJson, null, 2)}\n`;

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-builtin-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(stagingDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    fs.writeFileSync(
      path.join(stagingDir, 'icon.png'),
      Buffer.from(PLACEHOLDER_ICON_PNG_BASE64, 'base64'),
    );

    const ctx = buildInstallContext(async (req) => ({
      granted: req.permissions.map((p) => p.permission),
    }));

    const result = await installApp(
      { type: 'directory', path: stagingDir },
      ctx,
      { source: 'local' },
    );

    if (result.ok) {
      const tag = existing ? `升级 ${existing.version} → ${BUILTIN_GOOFISH_VERSION}` : `首次安装 ${BUILTIN_GOOFISH_VERSION}`;
      ensureGoofishDefaultAutomations(createAppDataStore(svc.db, BUILTIN_GOOFISH_APP_ID));
      console.log(`[init-builtin-resources] goofish-assistant ${tag}`);
    } else {
      console.warn(
        `[init-builtin-resources] goofish-assistant install failed: ${result.message}`,
      );
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function ensureDouyinCollectorInstalled(): Promise<void> {
  const svc = getAppPlatformService();
  const existing = svc.db
    .prepare('SELECT id, version FROM lumos_app_apps WHERE id = ?')
    .get(BUILTIN_DOUYIN_COLLECTOR_APP_ID) as
    | { id: string; version: string }
    | undefined;

  if (existing && existing.version === BUILTIN_DOUYIN_COLLECTOR_VERSION) {
    ensureDouyinDefaultAutomations(
      createAppDataStore(svc.db, BUILTIN_DOUYIN_COLLECTOR_APP_ID),
    );
    return;
  }

  const now = Date.now();
  const session: BuilderSession = {
    id: 'bs_builtin_douyin_collector',
    status: 'installed',
    appId: BUILTIN_DOUYIN_COLLECTOR_APP_ID,
    appName: '抖音采集器',
    appDescription:
      '按博主 / 关键词 / 链接采集抖音公开视频，抓字幕（必要时本地转写兜底），AI 摘要后入知识库；纯只读社交。',
    templateId: 'douyin-collector',
    createdAt: now,
    updatedAt: now,
  };

  const files = buildTemplateBlueprintFiles(session, 'douyin-collector', { now });
  if (!files) {
    console.warn('[init-builtin-resources] douyin-collector template returned null');
    return;
  }

  const appJson = JSON.parse(files['app.json']);
  appJson.id = BUILTIN_DOUYIN_COLLECTOR_APP_ID;
  appJson.version = BUILTIN_DOUYIN_COLLECTOR_VERSION;
  files['app.json'] = `${JSON.stringify(appJson, null, 2)}\n`;

  const stagingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lumos-douyin-collector-builtin-'),
  );
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(stagingDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    fs.writeFileSync(
      path.join(stagingDir, 'icon.png'),
      Buffer.from(PLACEHOLDER_ICON_PNG_BASE64, 'base64'),
    );

    const ctx = buildInstallContext(async (req) => ({
      granted: req.permissions.map((p) => p.permission),
    }));

    const result = await installApp(
      { type: 'directory', path: stagingDir },
      ctx,
      { source: 'local' },
    );

    if (result.ok) {
      const tag = existing
        ? `升级 ${existing.version} → ${BUILTIN_DOUYIN_COLLECTOR_VERSION}`
        : `首次安装 ${BUILTIN_DOUYIN_COLLECTOR_VERSION}`;
      ensureDouyinDefaultAutomations(
        createAppDataStore(svc.db, BUILTIN_DOUYIN_COLLECTOR_APP_ID),
      );
      console.log(`[init-builtin-resources] douyin-collector ${tag}`);
    } else {
      // Surface validation issues so silent install failures don't leave
      // users with a half-functional app (Settings tab crashing, etc).
      const issuesSummary = (result.issues ?? [])
        .slice(0, 8)
        .map((i) => {
          const r = i as { level?: string; file?: string; jsonPath?: string; message?: string };
          return `[${r.level ?? '?'}] ${r.file ?? '?'}${r.jsonPath ?? ''}: ${r.message ?? ''}`;
        })
        .join('\n  ');
      console.warn(
        `[init-builtin-resources] douyin-collector install failed: ${result.message}` +
          (issuesSummary ? `\n  ${issuesSummary}` : ''),
      );
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function ensureDeepResearchInstalled(): Promise<void> {
  const svc = getAppPlatformService();
  const existing = svc.db
    .prepare('SELECT id, version FROM lumos_app_apps WHERE id = ?')
    .get(BUILTIN_DEEP_RESEARCH_APP_ID) as
    | { id: string; version: string }
    | undefined;

  if (existing && existing.version === BUILTIN_DEEP_RESEARCH_VERSION) {
    ensureDeepResearchDefaultAutomations(
      createAppDataStore(svc.db, BUILTIN_DEEP_RESEARCH_APP_ID),
    );
    return;
  }

  const now = Date.now();
  const session: BuilderSession = {
    id: 'bs_builtin_deep_research',
    status: 'installed',
    appId: BUILTIN_DEEP_RESEARCH_APP_ID,
    appName: '深度调研',
    appDescription:
      '对话驱动的端到端深度调研工作台：澄清 → 目标 → 拆解 → 风险 → 采集 → 综合 → 报告 → 自检。',
    templateId: 'deep-research',
    createdAt: now,
    updatedAt: now,
  };

  const files = buildTemplateBlueprintFiles(session, 'deep-research', { now });
  if (!files) {
    console.warn('[init-builtin-resources] deep-research template returned null');
    return;
  }

  const appJson = JSON.parse(files['app.json']);
  appJson.id = BUILTIN_DEEP_RESEARCH_APP_ID;
  appJson.version = BUILTIN_DEEP_RESEARCH_VERSION;
  files['app.json'] = `${JSON.stringify(appJson, null, 2)}\n`;

  const stagingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lumos-deep-research-builtin-'),
  );
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(stagingDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    fs.writeFileSync(
      path.join(stagingDir, 'icon.png'),
      Buffer.from(PLACEHOLDER_ICON_PNG_BASE64, 'base64'),
    );

    const ctx = buildInstallContext(async (req) => ({
      granted: req.permissions.map((p) => p.permission),
    }));

    const result = await installApp(
      { type: 'directory', path: stagingDir },
      ctx,
      { source: 'local' },
    );

    if (result.ok) {
      const tag = existing
        ? `升级 ${existing.version} → ${BUILTIN_DEEP_RESEARCH_VERSION}`
        : `首次安装 ${BUILTIN_DEEP_RESEARCH_VERSION}`;
      ensureDeepResearchDefaultAutomations(
        createAppDataStore(svc.db, BUILTIN_DEEP_RESEARCH_APP_ID),
      );
      console.log(`[init-builtin-resources] deep-research ${tag}`);
    } else {
      const issuesSummary = (result.issues ?? [])
        .slice(0, 8)
        .map((i) => {
          const r = i as { level?: string; file?: string; jsonPath?: string; message?: string };
          return `[${r.level ?? '?'}] ${r.file ?? '?'}${r.jsonPath ?? ''}: ${r.message ?? ''}`;
        })
        .join('\n  ');
      console.warn(
        `[init-builtin-resources] deep-research install failed: ${result.message}` +
          (issuesSummary ? `\n  ${issuesSummary}` : ''),
      );
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

// ==========================================
// Main Initialization
// ==========================================

export async function initBuiltinResources(): Promise<void> {
  try {
    const skillsImported = importSkills();
    console.log(`[init-builtin-resources] Skills: ${skillsImported} new`);

    const mcpImported = importMcpServers();
    console.log(`[init-builtin-resources] MCP servers: ${mcpImported} new`);

    importProviders();

    seedBuiltinWorkflowAgentPresets();

    // goofish-assistant 是混合架构：UI 走 D 路径专属 React 应用（src/components/apps/builtin/goofish），
    // 数据层仍用应用平台的 AppDataStore（lumos_app_data），所以这里需要把骨架包安装好让
    // createAppDataStore('goofish-assistant') 能拿到 store。
    try {
      await ensureGoofishAssistantInstalled();
    } catch (err) {
      console.error('[init-builtin-resources] goofish-assistant install error:', err);
    }

    try {
      await ensureEcommerceAssistantInstalled();
    } catch (err) {
      console.error('[init-builtin-resources] ecommerce-assistant install error:', err);
    }

    try {
      const { resumeRunningJobs } = await import('./ecommerce-assistant/job-runner');
      await resumeRunningJobs();
    } catch (err) {
      console.error('[init-builtin-resources] ecommerce-assistant resume error:', err);
    }

    try {
      await ensureDouyinCollectorInstalled();
    } catch (err) {
      console.error('[init-builtin-resources] douyin-collector install error:', err);
    }

    try {
      await ensureDeepResearchInstalled();
    } catch (err) {
      console.error('[init-builtin-resources] deep-research install error:', err);
    }

    try {
      const { ensureAutomationDslSchema } = await import('./wechat-assistant/automations');
      await ensureAutomationDslSchema();
    } catch (err) {
      console.error('[init-builtin-resources] wechat-assistant DSL migration error:', err);
    }

    setSetting('builtin_resources_imported', 'true');
    console.log('[init-builtin-resources] Done');
  } catch (error) {
    console.error('[init-builtin-resources] Failed:', error);
    throw error;
  }
}
