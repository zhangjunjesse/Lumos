/**
 * 把 OpenWorkflow / 引擎抛出的原始错误字符串清洗成人话展示。
 *
 * 常见样式:
 *   - `Workflow XXX failed: {"name":"Error","message":"Task execution failed","stack":"Error:..."}`
 *     (openworkflow client.js 的 JSON.stringify 输出)
 *   - `Error: something\n    at fn (path:1:1)\n    ...`
 *   - 普通 message
 *
 * 目标:
 *   - 去掉 stack trace
 *   - 提取真实 message
 *   - message 为泛用占位符("Task execution failed")时,提示用户去完整执行记录看详情
 */

const GENERIC_MESSAGES = new Set([
  'Task execution failed',
  'Workflow execution failed',
  'Step execution failed',
]);

function stripStack(s: string): string {
  const atIdx = s.indexOf('\n    at ');
  if (atIdx > 0) return s.slice(0, atIdx).trim();
  return s;
}

export function formatWorkflowError(raw: string | null | undefined): string {
  if (!raw) return '未知错误';
  const s = raw.trim();
  if (!s) return '未知错误';

  // "Workflow X failed: {json}" — openworkflow client 包装
  const wrapped = s.match(/^Workflow\s+.+?\s+failed:\s*(\{[\s\S]*\})\s*$/);
  if (wrapped) {
    try {
      const obj = JSON.parse(wrapped[1]) as { message?: string; name?: string };
      const msg = (obj.message || obj.name || '').trim();
      if (msg) {
        return GENERIC_MESSAGES.has(msg)
          ? `${msg} · 请查看完整执行记录定位失败节点`
          : msg;
      }
    } catch { /* fallthrough */ }
  }

  // 普通 Error.toString() — 带 stack
  const noStack = stripStack(s);
  const firstLine = noStack.split('\n')[0]?.trim() ?? noStack;
  return firstLine.length > 0 ? firstLine : '未知错误';
}
