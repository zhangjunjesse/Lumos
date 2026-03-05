/**
 * Adapter registry
 */

export { FeishuAdapter } from './feishu-adapter';
export { registerAdapter, createAdapter, getAvailableAdapters } from './adapter-factory';

import { FeishuAdapter } from './feishu-adapter';
import { registerAdapter } from './adapter-factory';

registerAdapter('feishu', () => {
  const adapter = new FeishuAdapter();
  adapter.setConfig({
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!
  });
  return adapter;
});
