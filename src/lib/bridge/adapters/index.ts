/**
 * Adapter registry
 */

export { FeishuAdapter } from './feishu-adapter';
export { registerAdapter, createAdapter, getAvailableAdapters } from './adapter-factory';

import { FeishuAdapter } from './feishu-adapter';
import { registerAdapter } from './adapter-factory';
import { getFeishuCredentials } from '@/lib/feishu-config';

registerAdapter('feishu', () => {
  const { appId, appSecret } = getFeishuCredentials();
  const adapter = new FeishuAdapter();
  adapter.setConfig({
    appId,
    appSecret,
  });
  return adapter;
});
