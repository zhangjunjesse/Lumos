import { parseToolLoopResponseCandidate } from '../assistant-runtime-schema';
import { validateAppCapabilityContracts } from '../capability-contracts';

describe('app builder assistant runtime structured output parsing', () => {
  it('normalizes a single-string acceptanceCriteria value from the model', () => {
    const parsed = parseToolLoopResponseCandidate({
      actions: [{
        type: 'upsert_story',
        id: null,
        title: 'DeepSearch 报告生成',
        storyText: '用户输入主题后，系统用 DeepSearch 搜集资料并生成报告。',
        actor: null,
        priority: 'P1',
        acceptanceCriteria: '输入主题；自动搜索资料；生成报告',
        relatedPages: '首页；报告详情',
        relatedCollections: 'deepsearch_runs; reports',
      }],
    });

    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]).toMatchObject({
      type: 'upsert_story',
      id: undefined,
      actor: undefined,
      priority: 1,
      acceptanceCriteria: ['输入主题', '自动搜索资料', '生成报告'],
      relatedPages: ['首页', '报告详情'],
      relatedCollections: ['deepsearch_runs', 'reports'],
    });
  });

  it('treats null optional story fields as omitted', () => {
    const parsed = parseToolLoopResponseCandidate({
      actions: [{
        type: 'upsert_story',
        id: null,
        title: '资料报告',
        storyText: '作为用户，我希望输入主题后生成报告。',
        status: null,
        priority: null,
        acceptanceCriteria: null,
        relatedPages: null,
        relatedCollections: null,
      }],
    });

    expect(parsed.actions[0]).toMatchObject({
      type: 'upsert_story',
      id: undefined,
      status: undefined,
      priority: undefined,
      acceptanceCriteria: undefined,
      relatedPages: undefined,
      relatedCollections: undefined,
    });
  });

  it('treats blank optional story strings as omitted', () => {
    const parsed = parseToolLoopResponseCandidate({
      actions: [{
        type: 'upsert_story',
        id: '',
        title: '资料报告',
        storyText: '作为用户，我希望输入主题后生成报告。',
        actor: '   ',
      }],
    });

    expect(parsed.actions[0]).toMatchObject({
      type: 'upsert_story',
      id: undefined,
      actor: undefined,
    });
  });

  it('normalizes a single-string set_non_goals item list from the model', () => {
    const parsed = parseToolLoopResponseCandidate({
      action: {
        type: 'set_non_goals',
        items: '不要账号系统；不要付费墙',
      },
    });

    expect(parsed.actions).toEqual([{
      type: 'set_non_goals',
      items: ['不要账号系统', '不要付费墙'],
    }]);
  });

  it('allows confirming an existing story with id and status only', () => {
    const parsed = parseToolLoopResponseCandidate({
      actions: [{
        type: 'upsert_story',
        id: 'story_existing',
        status: 'confirmed',
      }],
    });

    expect(parsed.actions).toEqual([{
      type: 'upsert_story',
      id: 'story_existing',
      status: 'confirmed',
    }]);
  });

  it('still requires title and storyText when creating a new story', () => {
    expect(() => parseToolLoopResponseCandidate({
      actions: [{
        type: 'upsert_story',
        status: 'pending_confirmation',
      }],
    })).toThrow();
  });
});

describe('app builder capability contract checks', () => {
  it('rejects ai.complete without manifest permission', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'ai-report',
        name: 'AI 报告',
        version: '0.1.0',
        entry: 'home',
        routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
        permissions: {},
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['pages/index.tsx', `
import { ai } from '@lumos/app';
export default function Page() {
  void ai.complete('生成报告');
  return null;
}
`],
    ]));

    expect(issues.map((issue) => issue.message).join('\n')).toContain('permissions.ai.complete');
  });

  it('rejects ai.stream in generated apps for now', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'ai-report',
        name: 'AI 报告',
        version: '0.1.0',
        entry: 'home',
        routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
        permissions: { ai: { stream: true } },
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['pages/index.tsx', `
import { ai } from '@lumos/app';
export default function Page() {
  void ai.stream('生成报告');
  return null;
}
`],
    ]));

    expect(issues.map((issue) => issue.message).join('\n')).toContain('不要默认使用 ai.stream()');
  });

  it('allows ai.complete when manifest declares permission', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'ai-report',
        name: 'AI 报告',
        version: '0.1.0',
        entry: 'home',
        routes: [
          { id: 'home', path: '/', page: 'pages/index.tsx' },
          { id: 'agent-settings', path: '/agent-settings', page: 'pages/agent-settings.tsx' },
        ],
        permissions: { ai: { complete: true } },
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['pages/index.tsx', `
import { ai } from '@lumos/app';
export default function Page() {
  void ai.complete('生成报告', { system: '你是报告助手' });
  return null;
}
`],
      ['pages/agent-settings.tsx', `
export default function Settings() {
  return <div>
    <label>系统提示词</label>
    <textarea aria-label="system prompt" />
    <label>输出要求</label>
    <textarea aria-label="输出格式" />
    <label>temperature</label>
    <input aria-label="temperature" />
    <label>maxTokens</label>
    <input aria-label="maxTokens" />
  </div>;
}
`],
    ]));

    expect(issues).toEqual([]);
  });

  it('rejects ai.complete without visible agent settings UI', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'ai-report',
        name: 'AI 报告',
        version: '0.1.0',
        entry: 'home',
        routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
        permissions: { ai: { complete: true } },
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['pages/index.tsx', `
import { ai } from '@lumos/app';
export default function Page() {
  void ai.complete('生成报告');
  return <button>生成报告</button>;
}
`],
    ]));

    expect(issues.map((issue) => issue.message).join('\n')).toContain('AI/Agent 设置入口');
  });

  it('rejects workflow.run without bundled workflow file and management UI', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'workflow-app',
        name: '工作流应用',
        version: '0.1.0',
        entry: 'home',
        routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
        permissions: { workflow: { run: ['weekly-report'] } },
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['pages/index.tsx', `
import { workflow } from '@lumos/app';
export default function Page() {
  void workflow.run('weekly-report', {});
  return <button>运行</button>;
}
`],
    ]));

    const messages = issues.map((issue) => issue.message).join('\n');
    expect(messages).toContain('workflows/weekly-report.json');
    expect(messages).toContain('工作流管理/状态入口');
  });

  it('allows workflow.run with bundled workflow file and management UI', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'workflow-app',
        name: '工作流应用',
        version: '0.1.0',
        entry: 'home',
        routes: [
          { id: 'home', path: '/', page: 'pages/index.tsx' },
          { id: 'workflow-settings', path: '/workflow-settings', page: 'pages/workflow-settings.tsx' },
        ],
        permissions: { workflow: { run: ['weekly-report'] } },
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['workflows/weekly-report.json', JSON.stringify({
        id: 'weekly-report',
        name: '周报生成',
        description: '生成周报',
        inputs: [],
        outputs: [],
      })],
      ['pages/index.tsx', `
import { workflow } from '@lumos/app';
export default function Page() {
  void workflow.run('weekly-report', {});
  return <button>运行 weekly-report</button>;
}
`],
      ['pages/workflow-settings.tsx', `
export default function WorkflowSettings() {
  return <section>
    <h1>工作流 / 自动化</h1>
    <p>weekly-report</p>
    <p>运行状态 status</p>
    <p>失败原因 error</p>
    <button>重试 retry</button>
  </section>;
}
`],
    ]));

    expect(issues).toEqual([]);
  });

  it('rejects deepsearch calls without visible DeepSearch status UI', () => {
    const issues = validateAppCapabilityContracts(new Map([
      ['manifest.json', JSON.stringify({
        id: 'deepsearch-app',
        name: 'DeepSearch 应用',
        version: '0.1.0',
        entry: 'home',
        routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
        permissions: { deepsearch: { start: true, read: true } },
        runtime: { engine: 'react-v2', react: '19' },
      })],
      ['pages/index.tsx', `
import { deepsearch } from '@lumos/app';
export default function Page() {
  void deepsearch.start('主题');
  return <button>搜索</button>;
}
`],
    ]));

    expect(issues.map((issue) => issue.message).join('\n')).toContain('DeepSearch 配置/状态/结果入口');
  });
});
