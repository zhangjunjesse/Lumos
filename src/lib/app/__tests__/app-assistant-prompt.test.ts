import {
  buildAppAssistantSystemPrompt,
  buildAppAssistantUserPrompt,
} from '../app-assistant-prompt';
import type { AppManifest } from '../manifest/types';
import type { NativeAppStatusSummary } from '../status-service';

const manifest: AppManifest = {
  id: 'demo',
  name: 'Demo App',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'status',
};

const status: NativeAppStatusSummary = {
  appId: 'demo',
  appName: 'Demo App',
  status: 'failed',
  label: '失败',
  message: '最近一次运行失败，请查看运行结果页里的失败原因。',
  checkedAt: 1,
  counts: {
    settings: 1,
    runHistory: 3,
    runningRuns: 0,
    failedRuns: 1,
    acceptanceTotal: 4,
    acceptancePassed: 2,
    acceptanceIssues: 1,
  },
  latestRun: {
    source: 'run_history',
    status: 'failed',
    title: '同步消息',
    failureReason: '账号未连接',
  },
  missingCapabilities: [],
  readyCriteria: ['设置已保存'],
};

describe('app assistant prompt helpers', () => {
  it('uses app-specific system prompt and keeps write actions as drafts', () => {
    const prompt = buildAppAssistantSystemPrompt({
      manifest,
      systemPrompt: '你是订单助手。',
      riskNote: '外部发送必须确认。',
    });

    expect(prompt).toContain('你是订单助手');
    expect(prompt).toContain('不要声称已经自动执行');
    expect(prompt).toContain('外部发送必须确认');
  });

  it('adds a controlled reply draft action contract when enabled', () => {
    const prompt = buildAppAssistantSystemPrompt({
      manifest,
      systemPrompt: '',
      riskNote: '',
      enabledActions: ['create_reply_draft'],
    });

    expect(prompt).toContain('只能生成回复草稿');
    expect(prompt).toContain('[APP_ACTION]');
    expect(prompt).toContain('"type":"create_reply_draft"');
    expect(prompt).toContain('"reason":"为什么建议保存这条草稿"');
    expect(prompt).toContain('reason 必须说明为什么建议这个动作');
    expect(prompt).toContain('不要声称已经发送');
  });

  it('adds a controlled self-check action contract when enabled', () => {
    const prompt = buildAppAssistantSystemPrompt({
      manifest,
      systemPrompt: '',
      riskNote: '',
      enabledActions: ['run_self_check'],
    });

    expect(prompt).toContain('运行安装自检');
    expect(prompt).toContain('"type":"run_self_check"');
    expect(prompt).toContain('不要把它说成外部账号');
  });

  it('injects app status, counts, latest run, and user message', () => {
    const prompt = buildAppAssistantUserPrompt({
      appName: manifest.name,
      status,
      userMessage: '为什么失败？',
      riskNote: '',
      appContext: '最近买家会话：\n1. 张三；最近消息：能便宜点吗？',
    });

    expect(prompt).toContain('当前状态：失败');
    expect(prompt).toContain('设置数量：1');
    expect(prompt).toContain('失败数量：1');
    expect(prompt).toContain('验收进度：2/4');
    expect(prompt).toContain('验收异常：1');
    expect(prompt).toContain('账号未连接');
    expect(prompt).toContain('最近买家会话');
    expect(prompt).toContain('张三');
    expect(prompt).toContain('用户问题：为什么失败？');
  });
});
