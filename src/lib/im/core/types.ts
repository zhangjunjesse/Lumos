/**
 * IM Module — Core Contracts
 *
 * 这是 IM 模块的契约文件。所有 provider 必须实现这里定义的 IMAdapter；
 * 可选能力（P1）通过 mixin interface 自由组合。
 *
 * 改这个文件 = 跨所有 provider 的兼容性事件，先读 ./README.md。
 *
 * 文件分工：
 *   types.ts          ← 你在这里：P0 必选 + P1 可选 + manifest + plugin
 *   types-future.ts   ← P2 预留接口（M1-M5 不实现）
 */

/**
 * IM-local 附件类型，刻意与 src/types 的 FileAttachment 解耦：
 * core/* 不该依赖 app 级别类型（R6 单向依赖）。
 * 字段是 src/types/FileAttachment 的子集，结构兼容、按结构性 typing 互操作。
 */
export interface WechatProviderHints {
  nativeVoice?: boolean;
  contextToken?: string;
}

export interface IMProviderHints {
  wechat?: WechatProviderHints;
}

export interface IMFileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
  filePath?: string;
  providerHints?: IMProviderHints;
}
type FileAttachment = IMFileAttachment;

// ============================================================================
// Provider identity
// ============================================================================

export type IMProviderId = string;

// ============================================================================
// Address & Messages (P0 共用)
// ============================================================================

export interface ChannelAddress {
  providerId: IMProviderId;
  chatId: string;
  userId?: string;
  threadId?: string;
}

export interface InboundMessage {
  messageId: string;
  address: ChannelAddress;
  text: string;
  timestamp: number;
  callbackData?: string;
  attachments?: FileAttachment[];
  raw?: unknown;
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface OutboundMessage {
  address: ChannelAddress;
  text: string;
  parseMode?: 'plain' | 'markdown' | 'html';
  inlineButtons?: InlineButton[][];
  replyToMessageId?: string;
  attachments?: FileAttachment[];
  providerHints?: IMProviderHints;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Manifest & Config (描述一个 provider 长啥样)
// ============================================================================

export type IMConfigFieldType = 'string' | 'secret' | 'url' | 'enum' | 'boolean' | 'number';

export interface IMConfigField {
  key: string;
  label: string;
  type: IMConfigFieldType;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
  enumValues?: Array<{ value: string; label: string }>;
}

export interface IMCapabilities {
  chatTypes: Array<'direct' | 'group' | 'channel'>;
  media: boolean;
  reactions: boolean;
  threads: boolean;
  edit: boolean;
  commands: boolean;
  targetDirectory: boolean;
  streamingPreview: boolean;
}

export interface IMProviderManifest {
  id: IMProviderId;
  label: string;
  description: string;
  docsUrl?: string;
  configSchema: IMConfigField[];
  capabilities: IMCapabilities;
}

// ============================================================================
// IMAdapter (P0 — 必选)
// ============================================================================

export interface IMAdapter {
  readonly id: IMProviderId;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  consumeOne(): Promise<InboundMessage | null>;
  send(message: OutboundMessage): Promise<SendResult>;
  probe(): Promise<ProbeResult>;
  validateConfig(): string | null;
}

// ============================================================================
// P1 mixin: IMCommandHandler (Slash command)
// ============================================================================

export interface IMCommand {
  name: string;
  description: string;
  aliases?: string[];
}

export interface IMCommandContext {
  command: string;
  args: string[];
  message: InboundMessage;
}

export interface IMCommandResult {
  reply?: OutboundMessage;
  handled: boolean;
}

export interface IMCommandHandler {
  listCommands(): IMCommand[];
  handleCommand(ctx: IMCommandContext): Promise<IMCommandResult>;
}

// ============================================================================
// P1 mixin: IMTargetDirectory (AI 主动发消息时挑目标)
// ============================================================================

export interface IMTarget {
  id: string;
  name: string;
  kind: 'direct' | 'group' | 'channel';
  description?: string;
}

export interface ListTargetsOptions {
  query?: string;
  limit?: number;
  kind?: IMTarget['kind'];
}

export interface IMTargetDirectory {
  listTargets(opts?: ListTargetsOptions): Promise<IMTarget[]>;
  resolveTarget(query: string): Promise<IMTarget | null>;
}

// ============================================================================
// P1 mixin: IMStreamingPreview (流式打字卡片)
// ============================================================================

export interface PreviewHandle {
  providerId: IMProviderId;
  cardId: string;
  address: ChannelAddress;
}

export interface IMStreamingPreview {
  startPreview(address: ChannelAddress, initialText?: string): Promise<PreviewHandle>;
  updatePreview(handle: PreviewHandle, chunk: string): Promise<void>;
  finalizePreview(handle: PreviewHandle, finalText: string): Promise<void>;
}

// ============================================================================
// Plugin (registry 注册的单元)
// ============================================================================

export interface IMPlugin {
  manifest: IMProviderManifest;
  /**
   * 工厂方法：根据已 mask 解开的运行时 config，构造 adapter 实例。
   * config 已通过 config-store 校验过 manifest.configSchema。
   */
  createAdapter(config: Record<string, unknown>): IMAdapter;
}

// ============================================================================
// Type guards (用于在不确定 adapter 是否实现某 mixin 时判断)
// ============================================================================

export function hasCommands(adapter: IMAdapter): adapter is IMAdapter & IMCommandHandler {
  return typeof (adapter as Partial<IMCommandHandler>).handleCommand === 'function';
}

export function hasTargetDirectory(adapter: IMAdapter): adapter is IMAdapter & IMTargetDirectory {
  return typeof (adapter as Partial<IMTargetDirectory>).listTargets === 'function';
}

export function hasStreamingPreview(adapter: IMAdapter): adapter is IMAdapter & IMStreamingPreview {
  return typeof (adapter as Partial<IMStreamingPreview>).updatePreview === 'function';
}
