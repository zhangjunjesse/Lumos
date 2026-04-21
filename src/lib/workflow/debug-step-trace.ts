/**
 * 抽取某一次 debug run 里某个 step 的完整执行 trace(思考 + 工具调用 + 结果)。
 *
 * trace 的真相源:stage-worker 跑完后,`subagent.ts` 调 `formatStepOutputMarkdown`
 * 把 traceEvents 渲染成 markdown,再以 assistant message 写进 chat session。
 * debug cache(workflow_debug_step_outputs)只存结构化 output,不含 trace;因此
 * 查看"完整对话"必须经 schedule_run_history → chat session → messages 这条链。
 */
import { getDb } from '@/lib/db';
import { getMessages } from '@/lib/db/sessions';
import { parseStepHeader } from './step-output-formatter';

export interface DebugStepTrace {
  /** 完整 trace 的 markdown(以 `#### 执行过程` 开头);若未找到则为 null。 */
  trace: string | null;
  hasTrace: boolean;
}

const EMPTY: DebugStepTrace = { trace: null, hasTrace: false };

export function getDebugStepTrace(runId: string, stepId: string): DebugStepTrace {
  const row = getDb().prepare(
    "SELECT session_id FROM schedule_run_history WHERE id = ? AND mode = 'debug'",
  ).get(runId) as { session_id?: string | null } | undefined;
  if (!row?.session_id) return EMPTY;

  const { messages } = getMessages(row.session_id, { limit: 500 });
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const markdown = unwrapMessageMarkdown(msg.content);
    const parsed = parseStepHeader(markdown);
    if (!parsed || parsed.stepId !== stepId) continue;
    const trace = extractTraceSection(parsed.body);
    return { trace, hasTrace: !!trace };
  }
  return EMPTY;
}

/**
 * Chat 里 assistant message 的 content 是 `JSON.stringify([{type:'text',text:md}])`
 * (见 `subagent.ts` addMessage 调用处)。老格式可能直接存裸 markdown,都要兼容。
 */
export function unwrapMessageMarkdown(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((b: { type?: string; text?: string }) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: { text?: string }) => b.text ?? '')
        .join('\n');
    }
  } catch {
    // 裸 markdown,直接用
  }
  return content;
}

/**
 * `formatStepOutputMarkdown` 产出的 body 里,trace 由 `formatExecutionTrace` 注入,
 * 以 `---\n\n#### 执行过程...` 开头,结尾可能带一行 `<sub>...</sub>` 指标。
 * 把指标剥掉,只留 trace 本身。
 */
export function extractTraceSection(body: string): string | null {
  const idx = body.search(/####\s*执行过程/);
  if (idx < 0) return null;
  let trace = body.slice(idx).trim();
  trace = trace.replace(/\n+<sub>[\s\S]*?<\/sub>\s*$/, '').trim();
  return trace || null;
}
