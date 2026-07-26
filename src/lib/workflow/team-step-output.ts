// team 步骤的执行记录 markdown。
//
// 刻意复用 agent 那条链路的格式约定,好处是前端零改动就能点亮四个入口:
// RunOutputRenderer 的「执行过程」Tab、步骤摘要兜底、step-trace API(Codify 用)、debug trace。
// 它们都靠两个约定识别内容:
//   1. 首行隐藏头 <!-- step:roleName:stepId:outcome -->
//   2. 第一个独立的 `---` 之后是 trace 段(前端据此折叠)
// 所以这里不能自创格式。工具调用/思考/结果的渲染直接借 formatExecutionTrace,
// 截断规则(思考 1500 / 输入 2000 / 结果 3000 字)与 agent 一致。

import type { TeamTaskTrace } from '@/lib/team/task-trace';
import { formatExecutionTrace, type RawTraceEvent } from './step-output-formatter';

/** 成员明细过多时只展开前 N 个,避免一条消息几万字撑爆详情页。 */
const MAX_MEMBER_SECTIONS = 12;

function encodeField(s: string): string { return s.replace(/:/g, '：'); }

export interface TeamStepOutputInput {
  stepId: string;
  teamName: string;
  /** 队长最终交付文本。 */
  text: string;
  dispatches: number;
  dispatchedTo: string[];
  trace: TeamTaskTrace;
  outcome: 'done' | 'failed';
  error?: string;
  durationMs?: number;
}

export function formatTeamStepOutputMarkdown(input: TeamStepOutputInput): string {
  const parts: string[] = [];

  parts.push(`<!-- step:${encodeField(input.teamName)}:${encodeField(input.stepId)}:${input.outcome} -->`);
  parts.push('');

  if (input.outcome === 'failed') {
    parts.push(`> ${input.error || '团队任务执行失败'}`);
    parts.push('');
  }

  // 派单脉络:一眼看清谁接了活。这是 team 特有的、agent 没有的信息。
  if (input.dispatches > 0) {
    const roster = input.dispatchedTo.length > 0 ? input.dispatchedTo.join('、') : '未记录';
    parts.push(`**派单 ${input.dispatches} 次** → ${roster}`);
    parts.push('');
  } else {
    parts.push('> 队长没有派单(这一步的产出由队长直接给出)。');
    parts.push('');
  }

  if (input.text.trim()) {
    parts.push(input.text.trim());
    parts.push('');
  }

  const traceBody = buildTraceBody(input.trace);
  if (traceBody) {
    parts.push(traceBody);
    parts.push('');
  }

  if (input.durationMs != null) {
    parts.push(`<sub>耗时 ${formatDurationMs(input.durationMs)}</sub>`);
    parts.push('');
  }

  return parts.join('\n').trim();
}

/**
 * 队长层 + 成员层拼成一段 trace。
 * 必须以 `---` 开头:前端按第一个 `---` 切分 summary 与可折叠的 trace。
 */
function buildTraceBody(trace: TeamTaskTrace): string {
  const leaderTrace = formatExecutionTrace(trace.leader as RawTraceEvent[]);
  const shown = trace.members.slice(0, MAX_MEMBER_SECTIONS);
  const omitted = trace.members.length - shown.length;

  const memberBlocks: string[] = [];
  for (const section of shown) {
    const body = formatExecutionTrace(section.events as RawTraceEvent[]);
    if (!body) continue;
    // 去掉 formatExecutionTrace 自带的 `---\n\n#### 执行过程…` 抬头,换成成员小标题,
    // 否则嵌套的分隔线会把前端的 summary/trace 切分弄乱。
    memberBlocks.push(`##### 成员「${section.member}」\n\n${stripTraceHeading(body)}`);
  }
  if (omitted > 0) {
    memberBlocks.push(`> 还有 ${omitted} 位成员的执行明细未展开(单条记录长度上限)。`);
  }

  if (!leaderTrace && memberBlocks.length === 0) return '';

  const sections: string[] = [];
  if (leaderTrace) {
    sections.push(`#### 队长执行过程\n\n${stripTraceHeading(leaderTrace)}`);
  }
  sections.push(...memberBlocks);
  return `---\n\n${sections.join('\n\n')}`;
}

/** 剥掉 formatExecutionTrace 的 `---\n\n#### 执行过程(…)` 抬头,保留正文。 */
function stripTraceHeading(md: string): string {
  return md.replace(/^---\s*\n+\s*#### 执行过程[^\n]*\n+/, '').trim();
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
