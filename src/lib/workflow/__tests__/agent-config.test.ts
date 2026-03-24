const settingsStore = new Map<string, string>();

jest.mock('@/lib/db/sessions', () => ({
  getSetting: (key: string) => settingsStore.get(key),
  setSetting: (key: string, value: string) => {
    settingsStore.set(key, value);
  },
}));

describe('workflow agent config', () => {
  beforeEach(() => {
    settingsStore.clear();
    jest.resetModules();
  });

  test('returns default scheduling and execution role profiles when no overrides are stored', async () => {
    const { getSchedulingPlannerConfig, getWorkflowExecutionRoleConfig } = await import('../agent-config');

    const scheduling = getSchedulingPlannerConfig();
    const coder = getWorkflowExecutionRoleConfig('coder');

    expect(scheduling).toMatchObject({
      role: 'scheduling',
      plannerTimeoutMs: 90_000,
      plannerMaxRetries: 2,
    });
    expect(coder).toMatchObject({
      role: 'coder',
      concurrencyLimit: 1,
      allowedTools: ['workspace.read', 'workspace.write', 'shell.exec'],
    });
  });

  test('persists scheduling overrides and exposes them to planner consumers', async () => {
    const {
      getSchedulingPlannerConfig,
      updateWorkflowAgentRoleProfile,
    } = await import('../agent-config');

    updateWorkflowAgentRoleProfile('scheduling', {
      systemPrompt: 'Custom scheduling prompt',
      plannerTimeoutMs: 45_000,
      plannerMaxRetries: 1,
    });

    const scheduling = getSchedulingPlannerConfig();
    expect(scheduling).toMatchObject({
      systemPrompt: 'Custom scheduling prompt',
      plannerTimeoutMs: 45_000,
      plannerMaxRetries: 1,
    });
  });

  test('narrows execution role tools and concurrency via overrides, then resets to defaults', async () => {
    const {
      getWorkflowExecutionRoleConfig,
      resetWorkflowAgentRoleProfile,
      updateWorkflowAgentRoleProfile,
    } = await import('../agent-config');

    updateWorkflowAgentRoleProfile('integration', {
      systemPrompt: 'Custom integration prompt',
      allowedTools: ['workspace.read'],
      concurrencyLimit: 2,
    });

    const customized = getWorkflowExecutionRoleConfig('integration');
    expect(customized).toMatchObject({
      systemPrompt: 'Custom integration prompt',
      allowedTools: ['workspace.read'],
      concurrencyLimit: 2,
    });

    resetWorkflowAgentRoleProfile('integration');

    const reset = getWorkflowExecutionRoleConfig('integration');
    expect(reset).toMatchObject({
      systemPrompt: expect.stringContaining('You are the workflow integration agent.'),
      allowedTools: ['workspace.read', 'workspace.write'],
      concurrencyLimit: 1,
    });
  });
});
