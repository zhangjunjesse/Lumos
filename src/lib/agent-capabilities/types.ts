/**
 * Agent 能力注册中心 — 契约类型。
 *
 * 真源文档：docs/agent-capability-registry.md
 *
 * 强制不变量：
 * - R1 工具可见性与就绪态解耦：appliesTo 只读硬结构事实，禁读 readiness。
 * - R2 权限模式不做 per-connector 闸：策略集中在 registry 一处。
 * - R3 命名空间一致：一个连接器一个稳定 id。
 */
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { KnowledgeOverrides } from '@/types';

/** chat route 的 permissionMode 取值（plan/ask/code 映射后）。 */
export type PermissionMode = 'default' | 'plan' | 'acceptEdits';

/** in-process MCP server（createSdkMcpServer 产物，带 .name）。 */
export type InProcessMcpServer = McpSdkServerConfigWithInstance;

/**
 * 注册中心唯一输入。等价于 chat route 当前散读的那组事实。
 *
 * 仅承载「硬结构事实」+ 会话标识。**不含原始 session 对象**，
 * 以从结构上杜绝连接器在 appliesTo 里偷读 readiness（R1）。
 * 会话分类（主 agent / 微信专属 / workflow / 电商）由 route 预计算后传入。
 */
export interface ConnectorContext {
  sessionId: string;
  userId?: string;
  permissionMode: PermissionMode;
  // —— 硬结构事实（R1 允许 appliesTo 读取的全集）——
  browserAutomationIntent: boolean;
  visibleBrowserIntent: boolean;
  legacyImageAgentPrompt: boolean;
  isPrimaryMainAgentSession: boolean;
  isDedicatedWeChatAssistantSession: boolean;
  isWorkflowChatSession: boolean;
  isEcommerceAssistantChatSession: boolean;
  knowledgeEnabledForRequest: boolean;
  selectedKnowledgeTagIds: string[];
  knowledgeOverrides?: KnowledgeOverrides;
  /** 选中的浏览器上下文标签（chrome-devtools hint 用）。 */
  selectedBrowserLabel?: string;
}

/** 后端就绪态。只影响 hint 文案，永不影响工具存在性（R1）。 */
export type ConnectorReadiness =
  | { state: 'ready' }
  | { state: 'needs_setup'; reason: string; actionHint: string }
  | { state: 'needs_auth'; reason: string; actionHint: string }
  | { state: 'unavailable'; reason: string };

export const READY: ConnectorReadiness = { state: 'ready' };

export interface ConnectorResolution {
  /**
   * 本连接器拥有的 DB stdio MCP 名。
   * 注册中心据此决定 keep/skip——未通过 appliesTo 的连接器，其 owned 名进 skip 集。
   */
  ownedDbMcpNames?: string[];
  /**
   * 这些 DB MCP 即使用户未登录也应默认 is_enabled=1。
   * 取代 init-builtin-resources.ts 的 `||` always-on 硬链。
   */
  defaultEnabledDbMcpNames?: string[];
  /**
   * 内部后端 DB MCP：无论 appliesTo 真假**恒 skip**，永不直接对模型广告。
   * 例：wechat-export 是 lumos-wechat-assistant 的底层，agent 只用后者。
   */
  alwaysSkipDbMcpNames?: string[];
  /** in-process server 工厂；返回 null 表示本会话不注入。 */
  inProcess?: () => InProcessMcpServer | null;
  /**
   * in-process server 的**变体指纹**（R5）。
   *
   * resume 签名对 in-process server 只认名字，抓不到工具集/配置变体。
   * 若本 server 的行为依赖每轮可变输入（如 knowledge 的 tagIds/overrides），
   * 必须在此返回这些输入的稳定序列化——它会并入 resume 签名，使变更
   * 真正生效（变则起新会话，不变则照常 resume，零额外开销）。
   * 行为只依赖会话稳定量的 server 省略此项即可（name-only 已正确）。
   */
  inProcessVariantKey?: string;
}

export interface ConnectorDefinition {
  /** 稳定命名空间：'wechat' | 'goofish' | 'douyin' | 'x' | 'feishu' | … */
  id: string;
  label: string;
  /**
   * 本会话是否暴露该连接器（默认 true）。
   * R1：实现体只能读 ctx 的硬结构事实，**禁止任何 readiness 探测**。
   */
  appliesTo?: (ctx: ConnectorContext) => boolean;
  /**
   * 探测后端就绪态（默认 ready）。
   * 只用于 buildHint 文案；**不得**影响 resolve 的工具存在性（R1）。
   */
  probeReadiness?: (ctx: ConnectorContext) => ConnectorReadiness;
  /** 工具贡献。 */
  resolve: (ctx: ConnectorContext) => ConnectorResolution;
  /**
   * 模式无关的系统提示（phase 1，DB 解析前）。
   * 用于 in-process 连接器或 readiness 文案。收 readiness 以便说
   * 「已连接」vs「去授权」。
   */
  buildHint?: (ctx: ConnectorContext, readiness: ConnectorReadiness) => string | null;
  /**
   * DB-server 相关的系统提示（phase 2，DB 解析后）。
   * 仅当本连接器的 DB MCP 确实出现在已加载集合里才广告，避免广告
   * 未加载的工具。**恒附，不受 permissionMode 影响（R2）**。
   */
  buildDbHint?: (ctx: ConnectorContext, presentDbServers: Set<string>) => string | null;
  /**
   * Ask（纯问答）模式下，本连接器允许使用的**只读**工具的一句话描述
   * （R4 第三通道：Ask 工具许可也由注册中心驱动，不再是 route 里第三份
   * 手维护白名单）。返回 null = 本连接器在 Ask 模式无可用只读工具。
   * 仅 appliesTo 通过时求值；写/exec 类连接器应返回 null。
   */
  askModeReadAllowance?: (ctx: ConnectorContext) => string | null;
}

/** buildCapabilityPlan 输出——chat route 机械套用，零 per-connector 条件。 */
export interface CapabilityPlan {
  /** 传给 resolveEnabledMcpServers({ skipNames })。 */
  dbMcpSkipNames: Set<string>;
  /** 注入 streamClaude({ inProcessMcpServers })。 */
  inProcessServers: Record<string, InProcessMcpServer>;
  /**
   * serverName → 变体指纹。注入 streamClaude({ inProcessVariantKeys })，
   * 并入 resume 签名（R5）。无变体的 server 不出现在此（等价 name-only）。
   */
  inProcessVariantKeys: Record<string, string>;
  /** 直接拼到 finalSystemPrompt。 */
  systemHintAppend: string;
}
