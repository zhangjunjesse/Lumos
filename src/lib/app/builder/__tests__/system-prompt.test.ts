import type { AvailableCapabilities } from '../capabilities';
import { DEFAULT_APP_BUILDER_SYSTEM_PROMPT } from '../assistant-config';
import { buildAppBuilderSystemPrompt } from '../system-prompt';

const EMPTY_CAP: AvailableCapabilities = {
  mcps: [],
  agents: [],
  knowledge: [],
  nativeIntegrations: [],
  llmTiers: ['chat', 'reasoning', 'fast'],
  tools: ['bash', 'python', 'file', 'web-fetch'],
  codeAppsEnabled: false,
  workflowExecutionReady: false,
};

describe('buildAppBuilderSystemPrompt', () => {
  it('produces a non-empty prompt for an empty host', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    expect(out.length).toBeGreaterThan(800);
    expect(out).toContain('应用架构师');
    expect(out).toContain('JSON Schema');
  });

  it('includes the expected section dividers', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    const dividers = (out.match(/\n---\n/g) ?? []).length;
    // role | native-grade | output | patterns | capabilities | guardrails → 5 separators
    expect(dividers).toBeGreaterThanOrEqual(5);
  });

  it('frames generated apps as native-grade user-created apps', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    expect(out).toContain('内置级应用契约');
    expect(out).toContain('native-app-spec.json');
    expect(out).toContain('不要要求用户修改 Lumos 源码');
    expect(out).toContain('验收清单');
    expect(out).toContain('未接入 / 需官方能力');
    expect(out).toContain('接受当前版本后再安装');
    expect(out).toContain('/app <应用名或ID> status|runs|acceptance|help');
    expect(out).toContain('命令入口不是应用直接聊天');
    expect(out).toContain('docs/native-app-development-guide.md');
    expect(out).toContain('validate_app({ nativeGrade: true');
    expect(out).toContain('npm run validate:native-app -- <app-dir>');
  });

  it('pins the same native-grade protocol into the default AppBuilder runtime prompt', () => {
    expect(DEFAULT_APP_BUILDER_SYSTEM_PROMPT).toContain('内置级应用开发协议');
    expect(DEFAULT_APP_BUILDER_SYSTEM_PROMPT).toContain('docs/native-app-development-guide.md');
    expect(DEFAULT_APP_BUILDER_SYSTEM_PROMPT).toContain('docs/native-app-acceptance-checklist.md');
    expect(DEFAULT_APP_BUILDER_SYSTEM_PROMPT).toContain('validate_app({ nativeGrade: true');
    expect(DEFAULT_APP_BUILDER_SYSTEM_PROMPT).toContain('npm run validate:native-app -- <app-dir>');
    expect(DEFAULT_APP_BUILDER_SYSTEM_PROMPT).toContain('规格未接受时不能催用户安装');
  });

  it('warns about workflow runtime not being ready when flag is false', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    expect(out).toContain('工作流执行尚未接入');
  });

  it('warns about code apps being M6+', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    expect(out).toContain('M6+');
  });

  it('drops the workflow-runtime warning when ready', () => {
    const out = buildAppBuilderSystemPrompt({
      ...EMPTY_CAP,
      workflowExecutionReady: true,
    });
    expect(out).not.toContain('工作流执行尚未接入');
  });

  it('lists MCP ids and shows enabled vs disabled status', () => {
    const out = buildAppBuilderSystemPrompt({
      ...EMPTY_CAP,
      mcps: [
        { id: 'feishu', name: '飞书', description: 'Feishu', enabled: true, scope: 'builtin' },
        { id: 'bilibili', name: 'B 站', description: '', enabled: false, scope: 'user' },
      ],
    });
    expect(out).toContain('`feishu`');
    expect(out).toContain('已启用');
    expect(out).toContain('`bilibili`');
    expect(out).toContain('需用户先开启');
  });

  it('says "(未配置)" when no MCPs', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    expect(out).toContain('未配置');
  });

  it('includes design pattern keys', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    expect(out).toContain('输入-处理-输出');
    expect(out).toContain('列表-详情');
    expect(out).toContain('仪表板');
    expect(out).toContain('对话');
  });

  it('honours patternsOnly to scope generation to one mode', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP, { patternsOnly: ['tool'] });
    expect(out).toContain('输入-处理-输出');
    // The other three patterns should be absent. We use phrases that only
    // appear in the pattern blocks themselves (not e.g. "对话框" elsewhere).
    expect(out).not.toContain('列表-详情');
    expect(out).not.toContain('仪表板（分析型');
    expect(out).not.toContain('助手型');
  });

  it('produces an English prompt when locale is en-US', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP, { locale: 'en-US' });
    expect(out).toContain('Lumos App Architect');
    expect(out).toContain('Current capabilities');
    expect(out).not.toContain('架构师');
  });

  it('lists knowledge collections with item counts', () => {
    const out = buildAppBuilderSystemPrompt({
      ...EMPTY_CAP,
      knowledge: [
        { id: 'docs', name: '产品文档', itemCount: 50 },
        { id: 'cases', name: '客户案例', itemCount: 12 },
      ],
    });
    expect(out).toContain('`docs`');
    expect(out).toContain('50 items');
    expect(out).toContain('`cases`');
    expect(out).toContain('12 items');
  });

  it('lists agents with their roles', () => {
    const out = buildAppBuilderSystemPrompt({
      ...EMPTY_CAP,
      agents: [
        { id: 'researcher', name: 'Researcher', role: 'researcher' },
        { id: 'coder', name: 'Coder' },
      ],
    });
    expect(out).toContain('`researcher`');
    expect(out).toContain('`coder`');
  });

  it('lists native integrations and their safety boundary', () => {
    const out = buildAppBuilderSystemPrompt({
      ...EMPTY_CAP,
      nativeIntegrations: [
        {
          id: 'goofish',
          name: '闲鱼 / Goofish',
          status: 'requires_setup',
          setupUi: '扩展 > 闲鱼',
          readActions: ['读取会话', '搜索商品'],
          writeActions: ['发送文本消息，但必须用户确认'],
          highRiskActions: ['发送买家消息'],
          unavailableActions: ['发布商品', '自动无确认回复买家'],
          safetyRules: ['必须显示未接入'],
        },
      ],
    });
    expect(out).toContain('原生集成能力');
    expect(out).toContain('`goofish`');
    expect(out).toContain('需用户先在「扩展 > 闲鱼」完成配置');
    expect(out).toContain('自动无确认回复买家');
  });

  it('mentions the four whitelisted tools', () => {
    const out = buildAppBuilderSystemPrompt(EMPTY_CAP);
    for (const t of ['bash', 'python', 'file', 'web-fetch']) {
      expect(out).toContain(`\`${t}\``);
    }
  });
});
