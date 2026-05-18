/**
 * 默认启用的 DB MCP 名 —— **零重依赖**单一来源。
 *
 * 为什么单独一个文件：`init-builtin-resources` 是启动关键路径。若它
 * `import @/lib/agent-capabilities`（→ 连接器 → 微信助手 / 知识引擎 /
 * 全部工具工厂），只为拿这几个静态字符串，会在模块加载期把重依赖图
 * 拉进启动路径，徒增冷启动成本与循环依赖风险。本文件不 import 任何
 * 连接器/工厂，init 只依赖它。
 *
 * 与连接器契约的关系：这些名字必须各自对应一个已注册连接器声明的
 * `defaultEnabledDbMcpNames`。`registry.defaultEnabledDbMcpNames()` 仍
 * 由连接器图派生（运行时用）；`__tests__/registry.test.ts` 的奇偶校验
 * 把两者焊死——任一漂移即测试红，杜绝「加了连接器忘了这里」。
 *
 * 语义见 docs/agent-capability-registry.md：未登录返回结构化 not-ready
 * 而非工具消失的连接器才默认启用。
 */
export const DEFAULT_ENABLED_DB_MCP_NAMES = [
  'goofish-search',
  'douyin-collector',
  'x-platform',
] as const;
