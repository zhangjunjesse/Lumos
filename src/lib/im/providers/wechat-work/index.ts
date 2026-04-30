/**
 * WeChat Work Provider — Plugin Entry
 */

import type { IMPlugin } from '../../core/types';
import { wechatWorkManifest } from './manifest';
import { parseWechatWorkConfig } from './config';
import { WechatWorkAdapter } from './adapter';
import { runWechatWorkMigrations } from './migrations';

runWechatWorkMigrations();

export const wechatWorkPlugin: IMPlugin = {
  manifest: wechatWorkManifest,
  createAdapter: (rawConfig) => new WechatWorkAdapter(parseWechatWorkConfig(rawConfig)),
};

export type { WechatWorkConfig } from './config';
