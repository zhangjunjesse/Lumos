/**
 * Agent 能力注册中心 — 唯一裁决处。
 *
 * 真源文档：docs/agent-capability-registry.md
 *
 * chat route 不再散写 per-connector 门禁；它只调用 buildCapabilityPlan(ctx)
 * 并机械套用结果。权限模式策略（R2）集中在本文件，不外泄。
 *
 * 排序依赖：dbMcpSkipNames 必须在 resolveEnabledMcpServers 之前算出，
 * 故枚举 *已装 DB server* 的泛化发现提示留在 route（且恒附，不受权限模式影响）；
 * 本注册中心只负责内置连接器自身的 hint 广告。
 */
import {
  type CapabilityPlan,
  type ConnectorContext,
  type ConnectorDefinition,
  type ConnectorReadiness,
  READY,
} from './types';
import { CONNECTORS } from './connectors';

function appliesTo(def: ConnectorDefinition, ctx: ConnectorContext): boolean {
  return def.appliesTo ? def.appliesTo(ctx) : true;
}

function probe(def: ConnectorDefinition, ctx: ConnectorContext): ConnectorReadiness {
  if (!def.probeReadiness) return READY;
  try {
    return def.probeReadiness(ctx);
  } catch (err) {
    // 探针失败不得影响工具存在性（R1）——退化为 ready，hint 用通用文案。
    // 但要留痕：用户长期抱怨"不稳定/难诊断"，静默吞探针异常会掩盖根因。
    console.warn(
      `[agent-capabilities] connector "${def.id}" probeReadiness threw, degrading to ready:`,
      err instanceof Error ? err.message : err,
    );
    return READY;
  }
}

/**
 * 唯一能力裁决。算法见设计文档「解析器」节。
 *
 * - 未通过 appliesTo 的连接器：其 ownedDbMcpNames 全进 skip 集（等价旧散写
 *   skippedMcpNames + onlyBrowserMcpServers）。
 * - 通过的连接器：注入 inProcess、保留 owned DB（不 skip）、并入 hint。
 * - R2：permissionMode 不在此删任何读/消息连接器或 hint；写/exec 降级由
 *   连接器自身在 resolve 内依 ctx.permissionMode 决定（如微信 readOnly）。
 */
export function buildCapabilityPlan(ctx: ConnectorContext): CapabilityPlan {
  const dbMcpSkipNames = new Set<string>();
  const inProcessServers: CapabilityPlan['inProcessServers'] = {};
  const inProcessVariantKeys: CapabilityPlan['inProcessVariantKeys'] = {};
  const hints: string[] = [];

  for (const def of CONNECTORS) {
    // 故障隔离（R6）：单个连接器的 resolve/inProcess/buildHint 抛错
    // **不得**炸掉整张能力计划——否则一个连接器构造失败=用户失去全部
    // 能力、整个聊天 500。与 probe() 的降级一致：记一笔 warn，跳过该
    // 连接器，继续为其余连接器构建。这是注册中心的故障边界。
    try {
      // resolve() 每连接器只调一次（纯函数，但避免重复求值与无谓闭包）。
      const resolution = def.resolve(ctx);

      // 内部后端：无论 appliesTo 真假恒 skip（永不直接广告）。
      for (const name of resolution.alwaysSkipDbMcpNames ?? []) {
        dbMcpSkipNames.add(name);
      }

      if (!appliesTo(def, ctx)) {
        // 未暴露：其拥有的 DB MCP 进 skip（等价旧散写 skippedMcpNames）。
        for (const name of resolution.ownedDbMcpNames ?? []) {
          dbMcpSkipNames.add(name);
        }
        continue;
      }

      if (resolution.inProcess) {
        const server = resolution.inProcess();
        if (server) {
          inProcessServers[server.name] = server;
          // R5：把变体指纹按 server 名登记，供 resume 签名纳入。
          if (resolution.inProcessVariantKey) {
            inProcessVariantKeys[server.name] = resolution.inProcessVariantKey;
          }
        }
      }

      const hint = def.buildHint?.(ctx, probe(def, ctx));
      if (hint && hint.trim()) hints.push(hint.trim());
    } catch (err) {
      console.warn(
        `[agent-capabilities] connector "${def.id}" failed in buildCapabilityPlan, skipped:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    dbMcpSkipNames,
    inProcessServers,
    inProcessVariantKeys,
    systemHintAppend: hints.join('\n\n'),
  };
}

/**
 * Phase 2：DB server 解析后，由 route 无条件调用（R2：不受 permissionMode 影响）。
 *
 * presentDbServers 是 resolveEnabledMcpServers 实际返回的 server 名集合。
 * 每个连接器据此决定是否广告自己的 DB 工具——避免广告未加载的工具。
 * 取代 chat/route.ts 中 `permissionMode!=='default' && hasXMcp(...)` 那批闸。
 */
export function buildDbServerHints(
  ctx: ConnectorContext,
  presentDbServers: Set<string>,
): string {
  const hints: string[] = [];
  for (const def of CONNECTORS) {
    try {
      if (def.appliesTo && !def.appliesTo(ctx)) continue;
      const hint = def.buildDbHint?.(ctx, presentDbServers);
      if (hint && hint.trim()) hints.push(hint.trim());
    } catch (err) {
      // R6 故障隔离：单连接器 hint 抛错不炸掉全部广告。
      console.warn(
        `[agent-capabilities] connector "${def.id}" failed in buildDbServerHints, skipped:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return hints.join('\n\n');
}

/**
 * R4 第三通道：Ask（纯问答）模式工具许可，由注册中心驱动。
 *
 * 取代 chat/route.ts 里硬编码的 buildAskModeToolAllowance（它只给
 * 知识库/管家开口子、漏了微信——同一非对称白名单 bug 的第三处）。
 * 返回拼接进 Ask 系统提示的尾句：有可用只读连接器则枚举之，否则
 * 明确禁止用工具。措辞与旧实现一致以零回归。
 */
export function buildAskModeAllowance(ctx: ConnectorContext): string {
  const phrases: string[] = [];
  for (const def of CONNECTORS) {
    try {
      if (def.appliesTo && !def.appliesTo(ctx)) continue;
      const phrase = def.askModeReadAllowance?.(ctx);
      if (phrase && phrase.trim()) phrases.push(phrase.trim());
    } catch (err) {
      // R6 故障隔离：单连接器抛错不炸掉整句许可（宁可少一项也别 500）。
      console.warn(
        `[agent-capabilities] connector "${def.id}" failed in buildAskModeAllowance, skipped:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (phrases.length === 0) return ' Do not use any tools.';
  return ` You may use only ${phrases.join(' and ')}.`;
}

/**
 * init-builtin-resources.ts 调用：取代 `config.name === 'workflow' || …`
 * 硬链。新连接器只需声明 defaultEnabledDbMcpNames，注册即契约。
 *
 * 用一个稳定的「空上下文」求值——defaultEnabledDbMcpNames 只能依赖连接器
 * 静态声明，不得依赖会话事实。
 */
export function defaultEnabledDbMcpNames(): string[] {
  const names = new Set<string>();
  const staticCtx = NEUTRAL_CONTEXT;
  for (const def of CONNECTORS) {
    for (const name of def.resolve(staticCtx).defaultEnabledDbMcpNames ?? []) {
      names.add(name);
    }
  }
  return [...names];
}

/** 中性上下文：仅用于 defaultEnabledDbMcpNames 静态求值。 */
const NEUTRAL_CONTEXT: ConnectorContext = {
  sessionId: '',
  permissionMode: 'acceptEdits',
  browserAutomationIntent: false,
  visibleBrowserIntent: false,
  legacyImageAgentPrompt: false,
  isPrimaryMainAgentSession: false,
  isDedicatedWeChatAssistantSession: false,
  isWorkflowChatSession: false,
  isEcommerceAssistantChatSession: false,
  knowledgeEnabledForRequest: false,
  selectedKnowledgeTagIds: [],
};
