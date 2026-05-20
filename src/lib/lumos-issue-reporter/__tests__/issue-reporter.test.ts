import {
  formatLumosBugIssueBody,
  isAllowedIssueReporterEmail,
  submitLumosBugIssue,
  type IssueEnvironment,
} from '../issue-reporter';

function fakeEnvironment(): IssueEnvironment {
  return {
    appVersion: '0.25.51',
    nextPublicAppVersion: '0.25.51',
    nodeVersion: 'v22.0.0',
    electronVersion: '40.0.0',
    chromeVersion: '130.0.0.0',
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '25.0.0',
    osType: 'Darwin',
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN',
    nodeEnv: 'test',
    cwd: '/repo/lumos',
    dataDir: '/tmp/lumos',
    git: {
      repository: 'zhangjunjesse/Lumos',
      remote: 'https://github.com/zhangjunjesse/Lumos.git',
      branch: 'main',
      commit: 'abc1234',
      dirtyFileCount: 3,
    },
  };
}

describe('lumos issue reporter', () => {
  test('checks allowlisted emails case-insensitively', () => {
    expect(isAllowedIssueReporterEmail(' ZHANGJUN@XINGE.TECH ')).toBe(true);
    expect(isAllowedIssueReporterEmail('weiliuyan06@163.com')).toBe(true);
    expect(isAllowedIssueReporterEmail('someone@example.com')).toBe(false);
  });

  test('formats coding-oriented issue body with environment and acceptance checks', () => {
    const body = formatLumosBugIssueBody({
      input: {
        title: 'not used here',
        actualBehavior: '微信里显示 Tool result',
        expectedBehavior: '微信只显示自然语言',
        reproductionSteps: ['从微信发消息', '等待主 Agent 回复'],
        affectedArea: '主 Agent / 微信',
        uiRoute: '微信 Clawbot',
        severity: 'high',
        suspectedFiles: ['src/lib/bridge/conversation-engine.ts'],
        acceptanceChecks: ['真实微信端回复不包含 Tool result'],
      },
      reporter: { id: 'u1', email: 'zhangjun@xinge.tech', nickname: 'zhangjun' },
      environment: fakeEnvironment(),
      now: new Date('2026-05-20T08:00:00.000Z'),
    });

    expect(body).toContain('Lumos version: 0.25.51');
    expect(body).toContain('Runtime: Node v22.0.0, Electron 40.0.0, Chrome 130.0.0.0');
    expect(body).toContain('Git commit: abc1234');
    expect(body).toContain('src/lib/bridge/conversation-engine.ts');
    expect(body).toContain('真实微信端回复不包含 Tool result');
  });

  test('dry run returns a draft without requiring GitHub token', async () => {
    const result = await submitLumosBugIssue({
      title: '抖音采集失败后伪造字幕',
      actualBehavior: '工具失败后仍根据标题生成了字幕摘要。',
      confirmedByUser: false,
    }, {
      dryRun: true,
      reporter: { id: 'u1', email: 'zj391504704@gmail.com' },
    });

    expect(result.dryRun).toBe(true);
    expect(result.issueUrl).toBeUndefined();
    expect(result.body).toContain('抖音采集失败后伪造字幕');
  });

  test('rejects non-allowlisted reporter', async () => {
    await expect(submitLumosBugIssue({
      title: 'bug',
      actualBehavior: 'bad',
      confirmedByUser: true,
    }, {
      reporter: { id: 'u2', email: 'user@example.com' },
      createGithubIssue: jest.fn(),
    })).rejects.toThrow(/不在 bug 提交白名单/);
  });

  test('requires explicit confirmation for real submission', async () => {
    await expect(submitLumosBugIssue({
      title: 'bug',
      actualBehavior: 'bad',
      confirmedByUser: false,
    }, {
      reporter: { id: 'u1', email: 'zhangjun@xinge.tech' },
      createGithubIssue: jest.fn(),
    })).rejects.toThrow(/需要用户明确确认/);
  });

  test('submits through injected GitHub client with useful labels', async () => {
    const createGithubIssue = jest.fn(async (input) => ({
      issueNumber: 42,
      issueUrl: `https://github.com/${input.repository}/issues/42`,
      repository: input.repository,
      labelsApplied: input.labels,
    }));

    const result = await submitLumosBugIssue({
      title: '微信回复泄露工具调用',
      actualBehavior: '微信正文出现内部 tool result。',
      expectedBehavior: '微信正文不展示内部工具调用。',
      severity: 'high',
      confirmedByUser: true,
    }, {
      reporter: { id: 'u1', email: 'weiliuyan06@163.com' },
      createGithubIssue,
    });

    expect(result.issueUrl).toBe('https://github.com/zhangjunjesse/Lumos/issues/42');
    expect(createGithubIssue).toHaveBeenCalledWith(expect.objectContaining({
      repository: 'zhangjunjesse/Lumos',
      title: '[Bug] 微信回复泄露工具调用',
      labels: expect.arrayContaining(['bug', 'severity:high']),
    }));
  });
});
