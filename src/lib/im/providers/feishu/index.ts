/**
 * Feishu Provider — Plugin Entry
 *
 * 这是 src/lib/im/index.ts 唯一会 import 的文件。
 * 其余 provider 内部模块都不暴露给外界。
 */

import type { IMPlugin } from '../../core/types';
import { feishuManifest } from './manifest';
import { parseFeishuConfig } from './config';
import { FeishuAdapter } from './adapter';
import { runFeishuMigrations } from './migrations';

// 模块加载时自动跑一次迁移（幂等）
runFeishuMigrations();

export const feishuPlugin: IMPlugin = {
  manifest: feishuManifest,
  createAdapter: (rawConfig) => new FeishuAdapter(parseFeishuConfig(rawConfig)),
};

export type { FeishuConfig } from './config';
