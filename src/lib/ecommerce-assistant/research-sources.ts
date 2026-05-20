/**
 * Research-source contract + registry.
 *
 * 仅承载「数据源契约 + 注册表 + 数据/提示判定」。三个内置 adapter
 * （web / deepsearch / douyin）拆到 `research-source-adapters.ts`，避免单文件
 * 超 300 行硬规则。
 *
 * **依赖方向严格单向**：本模块**不** import adapters（否则 CJS 环下 adapters
 * 自注册时本模块导出可能尚未就绪）。adapters 单向依赖本模块并在加载时自
 * 注册；消费方（research-runner）用 side-effect import 触发。注册表用
 * globalThis 单例（与 research-lifecycle 一致），与模块求值顺序解耦。
 */

export interface ResearchSourceContext {
  platform: string;
  query: string;
  instruction: string | null;
  signal: AbortSignal;
}

export interface ResearchSourceItem {
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
  meta?: Record<string, unknown>;
  /**
   * 'data'（默认）= 真实采集到的研究数据；'notice' = 空态/引导/错误解释类
   * 提示信息。下游计数、行动建议分支、喂给 LLM 的输入都只认 data，notice
   * 仅作可见提示，绝不冒充数据（杜绝「web 全失败却报 2 条」这类脏数据）。
   */
  kind?: 'data' | 'notice';
}

export interface ResearchSourceResult {
  source: string;
  ok: boolean;
  items: ResearchSourceItem[];
  error?: string;
  latency_ms?: number;
}

export type ResearchSource = (ctx: ResearchSourceContext) => Promise<ResearchSourceResult>;

/** 构造一条提示项（非数据）。集中此处避免散写 `kind: 'notice'`。 */
export function notice(title: string, snippet?: string): ResearchSourceItem {
  return { title, snippet, kind: 'notice' };
}

/** 单条是否真实数据（未标 kind 默认 data，保持既有数据源行为不变）。 */
export function isDataItem(item: ResearchSourceItem): boolean {
  return item.kind !== 'notice';
}

/** 一个 source 结果里的真实数据条数（notice 不计）。 */
export function countDataItems(result: ResearchSourceResult): number {
  return result.ok ? result.items.filter(isDataItem).length : 0;
}

/** 截断片段到 max 字（通用，多个 adapter 共用）。 */
export function trimSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const REGISTRY_KEY = '__lumos_ecommerce_research_sources';

// 函数声明（hoisted）+ globalThis 单例：adapters 自注册时即便 sources 模块
// 尚未求值到此处也能安全拿到同一张表，规避 const TDZ / 环求值顺序问题。
function registry(): Map<string, ResearchSource> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map<string, ResearchSource>();
  return g[REGISTRY_KEY] as Map<string, ResearchSource>;
}

export function registerResearchSource(name: string, source: ResearchSource): void {
  registry().set(name, source);
}

export function getRegisteredSourceNames(): string[] {
  return Array.from(registry().keys()).sort();
}

export function getRegisteredSource(name: string): ResearchSource | undefined {
  return registry().get(name);
}

/** 清空注册表。供 adapters 的测试 reset 复用，避免它直接触碰内部 map。 */
export function clearRegisteredSources(): void {
  registry().clear();
}
