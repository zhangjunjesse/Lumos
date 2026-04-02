import { NextRequest, NextResponse } from 'next/server';
import { listRunHistory, listScheduledWorkflows } from '@/lib/db/scheduled-workflows';
import { getMessages } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/workflow/schedules/[id]/step-trace?stepId=xxx
 * 从最近一次 agent 执行中提取指定步骤的详细 trace，供 Codify 生成代码用。
 * 如果 id 为 "_global"，则在所有 schedule 中搜索。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id: scheduleId } = await context.params;
  const stepId = request.nextUrl.searchParams.get('stepId');
  if (!stepId) {
    return NextResponse.json({ error: '缺少 stepId 参数' }, { status: 400 });
  }

  // 收集要搜索的 schedule IDs
  const scheduleIds = scheduleId === '_global'
    ? listScheduledWorkflows().map(s => s.id)
    : [scheduleId];

  for (const sid of scheduleIds) {
    const runs = listRunHistory(sid, 10);
    for (const run of runs) {
      if (!run.sessionId) continue;
      const { messages } = getMessages(run.sessionId, { limit: 200 });

      for (const msg of messages) {
        if (msg.role !== 'assistant') continue;
        const trace = extractStepTrace(msg.content, stepId);
        if (trace) {
          return NextResponse.json({ trace, runId: run.id, runStatus: run.status });
        }
      }
    }
  }

  return NextResponse.json({ trace: null });
}

/**
 * 从 message content 中提取指定 stepId 的 trace 部分。
 * 格式：<!-- step:roleName:stepId:outcome --> 后的内容，
 * trace 在 --- 分隔线之后。
 */
function extractStepTrace(content: string, stepId: string): string | null {
  let text = content;
  try {
    const blocks = JSON.parse(content) as Array<{ type: string; text?: string }>;
    if (Array.isArray(blocks)) {
      text = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text as string).join('\n');
    }
  } catch { /* not JSON */ }

  // 检查是否是目标步骤的输出
  const headerPattern = new RegExp(`<!--\\s*step:[^:]+:${escapeRegex(stepId)}:[^>]+-->`);
  if (!headerPattern.test(text)) return null;

  // 提取完整内容（header 之后的所有内容，包含 summary 和 trace）
  const headerMatch = text.match(headerPattern);
  if (!headerMatch) return null;
  const afterHeader = text.slice(headerMatch.index! + headerMatch[0].length).trim();

  // 返回完整内容，Codify 需要看到 summary + trace
  return afterHeader || null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
