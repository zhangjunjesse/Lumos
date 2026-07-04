/**
 * 内部后端 MCP —— 某个上层能力的私有实现，永不作为 agent 可调工具加载，
 * 也永不直接对模型广告。
 *
 * 例：`wechat-export` 是 `lumos-wechat-assistant`（带镜像同步 + 分页 + 只读
 * 包装）的底层解密后端。任何运行时（chat / workflow / bridge）都不得把它作为
 * 裸工具暴露给 agent —— 否则只读包装被绕过，agent 直接拿到全量解密聊天库的
 * 裸读写工具。
 *
 * 这是**上下文无关的安全不变量**，故下沉到 `resolveEnabledMcpServers` 默认
 * 排除（见 mcp-resolver.ts Step 0）：安全默认优于「每个调用方都记得传
 * skipNames」的约定纪律 —— stage-worker 曾因忘传 skipNames 让 wechat-export
 * 在 workflow agent 里裸露，正是这类约定失效的实证。
 *
 * 单一真源：agent-capabilities 的 wechat 连接器也从这里取名字，不再各写字面量。
 */
export const WECHAT_EXPORT_MCP_NAME = 'wechat-export';

/** 全部内部后端名。resolver 默认排除本集合中的任何 MCP。 */
export const INTERNAL_BACKEND_MCP_NAMES: ReadonlySet<string> = new Set([
  WECHAT_EXPORT_MCP_NAME,
]);
