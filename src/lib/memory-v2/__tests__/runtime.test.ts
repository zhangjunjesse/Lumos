import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Memory v2 action memory runtime', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-memory-v2-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('@/lib/db/connection');
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    jest.resetModules();
  });

  it('captures explicit resource memory without storing raw secret values', async () => {
    const { createSession } = await import('@/lib/db');
    const { captureExplicitMemoryV2FromUserInput } = await import('../runtime');
    const projectPath = path.join(tmpDir, 'lumos');
    const session = createSession('Lumos project', '', '', projectPath, 'code');

    const memory = captureExplicitMemoryV2FromUserInput({
      sessionId: session.id,
      projectPath,
      messageId: 'msg-1',
      userInput: '记住这个项目的服务器密码是 abc123456，部署时需要用',
    });

    expect(memory).toBeTruthy();
    expect(memory?.kind).toBe('resource');
    expect(memory?.scope_type).toBe('project');
    expect(memory?.scope_key).toBe(projectPath);
    expect(memory?.message_id).toBe('msg-1');
    expect(memory?.source_id).toBe('msg-1');
    expect(memory?.sensitivity).toBe('sensitive_ref');
    expect(memory?.secret_ref).toMatch(/^secret:\/\/memory-v2\//);
    expect(memory?.body).not.toContain('abc123456');
    expect(memory?.body).toContain('已自动加密保存到 Vault');

    const { getMemoryV2SecretValue } = await import('../secret-vault');
    expect(getMemoryV2SecretValue(memory!.secret_ref)).toBe('abc123456');
  });

  it('builds a scoped action memory pack for the active project and session', async () => {
    const { createSession } = await import('@/lib/db');
    const { createMemoryV2Entry } = await import('../store');
    const { buildMemoryV2PackForPrompt } = await import('../runtime');
    const projectPath = path.join(tmpDir, 'project-a');
    const otherProject = path.join(tmpDir, 'project-b');
    const session = createSession('Project A', '', '', projectPath, 'code');

    createMemoryV2Entry({
      kind: 'people',
      scopeType: 'user',
      scopeKey: 'default',
      title: '用户希望先结论',
      body: '用户偏好先给结论，再给必要细节。',
      tags: ['preference'],
    });
    createMemoryV2Entry({
      kind: 'task',
      scopeType: 'project',
      scopeKey: projectPath,
      projectPath,
      title: '项目采用 Memory v2',
      body: '这个项目的记忆系统第一阶段只做行动记忆，不做完整自我进化。',
      tags: ['decision'],
    });
    createMemoryV2Entry({
      kind: 'task',
      scopeType: 'session',
      scopeKey: session.id,
      sessionId: session.id,
      title: '当前会话讨论作用域',
      body: '当前会话正在确认主代理、项目和会话之间的记忆边界。',
    });
    createMemoryV2Entry({
      kind: 'task',
      scopeType: 'project',
      scopeKey: otherProject,
      projectPath: otherProject,
      title: '其他项目记忆',
      body: '这条记忆不应该出现在 Project A 的上下文中。',
    });

    const pack = buildMemoryV2PackForPrompt({
      sessionId: session.id,
      projectPath,
      prompt: '继续设计 Memory v2 的项目记忆作用域',
    });

    expect(pack.text).toContain('<lumos_action_memory_v2>');
    expect(pack.text).toContain('用户偏好先给结论');
    expect(pack.text).toContain('第一阶段只做行动记忆');
    expect(pack.text).toContain('当前会话正在确认');
    expect(pack.text).not.toContain('其他项目记忆');
  });

  it('reflection reports resources that still need a vault reference', async () => {
    const { createMemoryV2Entry } = await import('../store');
    const { buildMemoryV2ReflectionReport, createMemoryV2ReflectionEntry } = await import('../reflection');

    const memory = createMemoryV2Entry({
      kind: 'resource',
      scopeType: 'user',
      scopeKey: 'default',
      title: '生产服务器凭证',
      body: '生产服务器 SSH 凭证已隐藏，使用前需要 Vault 引用。',
      sensitivity: 'secret_ref_required',
      tags: ['resource', 'security'],
    });

    const report = buildMemoryV2ReflectionReport();
    expect(report.stats.resourcesNeedingVault).toBe(1);
    expect(report.issues.some((issue) => issue.memoryIds.includes(memory.id) && issue.category === 'resource')).toBe(true);

    const run = createMemoryV2ReflectionEntry();
    expect(run.memory.kind).toBe('reflection');
    expect(run.memory.scope_type).toBe('main_agent');
    expect(run.memory.body).toContain('待补 Vault');
  });

  it('turns capability gaps into self-improvement candidates for the builder', async () => {
    const { createMemoryV2Entry } = await import('../store');
    const {
      buildCapabilityBuilderPromptForImprovement,
      generateMemoryV2ImprovementCandidates,
      listMemoryV2ImprovementCandidates,
    } = await import('../self-improvement');

    const memory = createMemoryV2Entry({
      kind: 'capability',
      scopeType: 'main_agent',
      scopeKey: 'main',
      title: '需要查询外部订单 API 的能力',
      body: '当前主代理缺少 MCP 工具，无法调用外部订单 API 查询状态，需要补齐能力。',
      tags: ['capability', 'mcp', 'gap'],
      importance: 4,
    });

    const first = generateMemoryV2ImprovementCandidates();
    expect(first.scanned).toBe(1);
    expect(first.created).toHaveLength(1);
    expect(first.created[0].candidate_type).toBe('mcp');
    expect(first.created[0].source_memory_ids).toContain(memory.id);

    const second = generateMemoryV2ImprovementCandidates();
    expect(second.created).toHaveLength(0);
    expect(listMemoryV2ImprovementCandidates()).toHaveLength(1);

    const prompt = buildCapabilityBuilderPromptForImprovement(first.created[0]);
    expect(prompt).toContain('lumos-extension-plan');
    expect(prompt).toContain(first.created[0].id);
    expect(prompt).toContain('不要把任何密码');
  });

  it('runs daily sleep once per local day and records the reflection memory', async () => {
    const { addMessage, createSession } = await import('@/lib/db');
    const { createMemoryV2Entry, listMemoryV2Entries } = await import('../store');
    const { getMemoryV2SleepConfig, listMemoryV2SleepRuns, runMemoryV2Sleep, updateMemoryV2SleepConfig } = await import('../sleep');
    const { listMemoryV2ImprovementCandidates } = await import('../self-improvement');
    const session = createSession('Memory v2 sleep auto summary', '', '', path.join(tmpDir, 'lumos'), 'code');
    addMessage(session.id, 'user', '以后不要让我手动点归档或确认，记忆应该由系统自动处理。');

    createMemoryV2Entry({
      kind: 'task',
      scopeType: 'main_agent',
      scopeKey: 'main',
      title: '睡眠测试任务',
      body: '睡眠模式需要把记忆健康检查沉淀成主代理复盘。',
      tags: ['sleep'],
    });
    createMemoryV2Entry({
      kind: 'capability',
      scopeType: 'main_agent',
      scopeKey: 'main',
      title: '需要订单 API 查询能力',
      body: '当前主代理缺少 MCP 工具，无法调用订单 API 查询状态，需要补齐能力。',
      tags: ['capability', 'gap'],
    });
    updateMemoryV2SleepConfig({ enabled: true, time: '00:00' });

    const first = runMemoryV2Sleep({ trigger: 'daily', force: true });
    expect(first.status).toBe('success');
    expect(first.memoryId).toBeTruthy();
    expect(listMemoryV2ImprovementCandidates()).toHaveLength(1);
    const autoMemories = listMemoryV2Entries({ query: '手动点归档', limit: 10 });
    expect(autoMemories.some((memory) => memory.source_type === 'memory_v2_sleep_auto_summary')).toBe(true);

    const config = getMemoryV2SleepConfig();
    const second = runMemoryV2Sleep({ trigger: 'daily' });
    expect(second.status).toBe('skipped');
    expect(second.error).toBe('already_ran_today');
    expect(second.runDay).toBe(config.today);

    const runs = listMemoryV2SleepRuns();
    expect(runs.some((run) => run.id === first.id && run.memoryId === first.memoryId)).toBe(true);
  });
});
