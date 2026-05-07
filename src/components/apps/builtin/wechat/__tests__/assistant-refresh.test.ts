import { refreshWeChatAssistantTargets } from '../assistant-refresh';

describe('wechat assistant refresh targets', () => {
  it('refreshes followups when the bottom assistant updates app state', async () => {
    const calls: string[] = [];

    await refreshWeChatAssistantTargets({
      refreshFollowups: async () => {
        calls.push('followups');
      },
      refreshAutomations: async () => {
        calls.push('automations');
      },
      refreshOverview: async () => {
        calls.push('overview');
      },
    });

    expect(calls).toEqual(['followups', 'automations', 'overview']);
  });
});
