/**
 * 微信助手「总结意图」的唯一解析层（旧架构 3 处启发式收敛于此）。
 *
 * 自然语言只在创建期被 deriveSummarySpec 解析一次成结构化 SummarySpec，
 * 经 withSummarySpec 持久化进 automation；下游（DSL 构建 / handler）只读
 * spec，不再各层反推。effectiveSummarySpec 让纯函数消费方独立自洽（缺
 * spec 现场 derive，不依赖调用方先 mutate）。
 *
 * 从 automations.ts 拆出（CLAUDE.md 单文件 ≤300 行；intent-spec 自成一层）。
 */
import type {
  Automation,
  SummarySpec,
} from '@/components/apps/builtin/wechat/relations-types';
import type { GroupTag } from '@/components/apps/builtin/wechat/app-settings';

import { getWeChatAssistantSettings } from './settings-store';

const EMPTY_MESSAGE_RE = /(?:如果|若|要是)?(?:没有|无)[^，。\n]{0,8}?(?:就|则)?说[「"“]?([^」"”，。\n]{1,24})/;

/**
 * 唯一意图解析器。是否"总结"由 action.kind **显式**决定（wechat_summary），
 * 不再从 custom 文本猜——旧的「总结动词+微信范围词」双信号会把普通提醒
 * （如"提醒我梳理客户群进展"）静默切成全量扫私信生成报告，非确定性、
 * 无 UI 暴露。执行方式现在在新建弹框里显式选。
 *
 * 是总结则把自然语言解析成结构化 SummarySpec：
 * - scope：显式 groupTagId 优先；否则按指令文本匹配已配置群标签名（最长优先）；
 *   都没有 = 全部会话。
 * - emptyMessage：探测"没有就说X"话术（可选，缺省由 handler 兜底默认）。
 * - extraInstruction：用户原话原样保留，作为 LLM scopeNote 透传，绝不丢弃。
 * 非总结（含一切 custom）返回 undefined。
 */
export function deriveSummarySpec(
  automation: Pick<Automation, 'name' | 'action'>,
  groupTags: GroupTag[],
): SummarySpec | undefined {
  const action = automation.action;
  const text = `${automation.name}\n${action.messageTemplate}`;
  if (action.kind !== 'wechat_summary') return undefined;

  let scope: SummarySpec['scope'] = { kind: 'all' };
  if (action.kind === 'wechat_summary' && action.groupTagId) {
    scope = { kind: 'group_tag', tagId: action.groupTagId };
  } else {
    const matched = matchGroupTagByName(text, groupTags);
    if (matched) scope = { kind: 'group_tag', tagId: matched.id };
  }

  const empty = EMPTY_MESSAGE_RE.exec(action.messageTemplate)?.[1]?.trim();
  return {
    scope,
    emptyMessage: empty || undefined,
    extraInstruction: action.messageTemplate.trim() || undefined,
  };
}

/** 按已配置群标签名做子串匹配，最长（最具体）优先。 */
function matchGroupTagByName(text: string, tags: GroupTag[]): GroupTag | null {
  const hay = text.toLowerCase();
  let best: GroupTag | null = null;
  for (const tag of tags ?? []) {
    const name = tag.name.trim().toLowerCase();
    if (!name || !hay.includes(name)) continue;
    if (!best || tag.name.trim().length > best.name.trim().length) best = tag;
  }
  return best;
}

/**
 * 归一：summarySpec 严格随 action.kind——显式 wechat_summary 写入/刷新，
 * 其它一律剥除。单一真源是 action.kind（用户在弹框显式选的执行方式），
 * 不再有"文本猜的 spec"游离态；用户把执行方式改回纯提醒即真的变纯提醒。
 */
export function withSummarySpec(automation: Automation): Automation {
  const spec = deriveSummarySpec(
    automation,
    getWeChatAssistantSettings().groupTags ?? [],
  );
  if (spec) return { ...automation, summarySpec: spec };
  if (!automation.summarySpec) return automation;
  const { summarySpec: _drop, ...rest } = automation;
  return rest;
}

/**
 * 取生效 spec：持久化的 summarySpec 优先（syncSchedule 经 withSummarySpec
 * 写入，是真源）；缺失时现场 derive——使 buildAutomationWorkflowDsl 这个
 * 导出纯函数独立自洽，不依赖调用方先 mutate（更好测、无隐式顺序坑）。
 */
export function effectiveSummarySpec(
  automation: Pick<Automation, 'name' | 'action' | 'summarySpec'>,
): SummarySpec | undefined {
  return (
    automation.summarySpec ??
    deriveSummarySpec(automation, getWeChatAssistantSettings().groupTags ?? [])
  );
}

/** 有 summarySpec = 总结类。取代旧的文本分类启发式。 */
export function isWeChatSummaryAutomation(
  automation: Pick<Automation, 'name' | 'action' | 'summarySpec'>,
): boolean {
  return !!effectiveSummarySpec(automation);
}
