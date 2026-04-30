/**
 * WeChat (QClaw) Provider — Plugin Entry
 */

import type { IMPlugin } from '../../core/types';
import { wechatQclawManifest } from './manifest';
import { parseQClawConfig } from './config';
import { WechatQClawAdapter } from './adapter';
import { runWechatQclawMigrations } from './migrations';

runWechatQclawMigrations();

export const wechatQclawPlugin: IMPlugin = {
  manifest: wechatQclawManifest,
  createAdapter: (rawConfig) => new WechatQClawAdapter(parseQClawConfig(rawConfig)),
};

export type { QClawConfig } from './config';
