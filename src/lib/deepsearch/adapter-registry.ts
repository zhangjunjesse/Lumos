import type { SiteAdapter } from './adapter-types';
import { zhihuAdapter } from './adapters/zhihu';
import { wechatAdapter } from './adapters/wechat';
import { genericAdapter } from './adapters/generic';

const adapters = new Map<string, SiteAdapter>([
  ['zhihu', zhihuAdapter],
  ['wechat', wechatAdapter],
]);

/** Get a site-specific adapter, or fall back to the generic browser-based adapter */
export function getAdapter(siteKey: string): SiteAdapter {
  return adapters.get(siteKey) || genericAdapter;
}

/** List all registered site keys */
export function listAdapterKeys(): string[] {
  return Array.from(adapters.keys());
}
