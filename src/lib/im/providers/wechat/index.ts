/**
 * WeChat Provider — Plugin Entry
 */

import type { IMPlugin } from '../../core/types';
import { wechatManifest } from './manifest';
import { parseWechatConfig } from './config';
import { WechatAdapter } from './adapter';
import { runWechatMigrations } from './migrations';

runWechatMigrations();

export const wechatPlugin: IMPlugin = {
  manifest: wechatManifest,
  createAdapter: (rawConfig) => new WechatAdapter(parseWechatConfig(rawConfig)),
};

export type { WechatConfig } from './config';
export { WechatAdapter } from './adapter';
export { parseWechatConfig } from './config';
