export interface WeChatAssistantRefreshTargets {
  refreshFollowups: () => Promise<void> | void;
  refreshAutomations: () => Promise<void> | void;
  refreshOverview: () => Promise<void> | void;
}

export async function refreshWeChatAssistantTargets(
  targets: WeChatAssistantRefreshTargets,
): Promise<void> {
  await targets.refreshFollowups();
  await targets.refreshAutomations();
  await targets.refreshOverview();
}
