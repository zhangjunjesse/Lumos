/**
 * IM Module — Public Barrel
 *
 * 这是 lumos 其它部分访问 IM 能力的唯一入口。
 * 外部代码：`import { ... } from '@/lib/im';`
 * 禁止直接 import providers/* 的内部文件。
 *
 * 加新 provider = 在下面的 register 列表添加一行。
 */

import { registerPlugin } from './core/registry';

// ============================================================================
// 静态 provider 注册（M2 起逐个上线）
// ============================================================================

// import { feishuPlugin } from './providers/feishu';
// import { wechatQclawPlugin } from './providers/wechat-qclaw';
// import { wechatWorkPlugin } from './providers/wechat-work';

// registerPlugin(feishuPlugin);
// registerPlugin(wechatQclawPlugin);
// registerPlugin(wechatWorkPlugin);

void registerPlugin; // 占位避免 unused-import；M2 起 register 列表会真正用到

// ============================================================================
// 类型
// ============================================================================

export type {
  IMProviderId,
  IMAdapter,
  IMPlugin,
  IMProviderManifest,
  IMConfigField,
  IMConfigFieldType,
  IMCapabilities,
  ChannelAddress,
  InboundMessage,
  OutboundMessage,
  SendResult,
  ProbeResult,
  InlineButton,
  IMCommand,
  IMCommandContext,
  IMCommandResult,
  IMCommandHandler,
  IMTarget,
  IMTargetDirectory,
  ListTargetsOptions,
  IMStreamingPreview,
  PreviewHandle,
} from './core/types';

export { hasCommands, hasTargetDirectory, hasStreamingPreview } from './core/types';

// ============================================================================
// Registry（哪些 IM 已注册）
// ============================================================================

export { getPlugin, listPlugins, listProviderIds, hasProvider } from './core/registry';

// ============================================================================
// Config Store（启用/默认/单 IM 配置）
// ============================================================================

export {
  getProviderConfig,
  setProviderConfig,
  isProviderConfigured,
  getEnabledProviders,
  setProviderEnabled,
  isProviderEnabled,
  getDefaultProviderId,
  setDefaultProviderId,
} from './core/config-store';

// ============================================================================
// Runtime（启停 + 出站发送）
// ============================================================================

export {
  startAdapter,
  stopAdapter,
  restartAdapter,
  startAllEnabled,
  stopAll,
  getActiveAdapter,
  listActiveAdapters,
  sendToProvider,
  sendToDefault,
} from './core/runtime';
