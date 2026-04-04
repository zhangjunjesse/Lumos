import type { ChatSession } from '@/types';
import { getSetting } from '@/lib/db/sessions';
import { listAgentPresets } from '@/lib/db/agent-presets';
import { WORKFLOW_REFINE_PROMPT } from '@/lib/workflow/default-prompts';

export const WORKFLOW_CHAT_TITLE = '工作流 AI 助手';
export const WORKFLOW_CHAT_MARKER = '__LUMOS_WORKFLOW_CHAT__';

const WORKFLOW_CAPABILITIES_HINT = `

## 能力说明
你不仅是工作流编辑助手，还拥有完整的工具和 MCP 能力。你可以：
- 编辑和优化工作流 DSL
- 使用所有已挂载的 MCP 工具（如浏览器控制、DeepSearch、飞书等）帮用户调试工作流节点
- 读写文件、执行命令，帮助排查工作流执行中的问题
- 分析工作流执行日志和 Agent 输出

当用户要求调试或测试工作流节点时，主动使用可用的 MCP 工具完成任务，不要拒绝。

## 代码模式调试工具（run_workflow_code）

你拥有 run_workflow_code 工具，可以直接在服务端执行工作流步骤的 JavaScript 代码。
脚本是 async function body（直接写语句，不要写 function 声明），最后必须 return { success: boolean, output: { summary: string } }。

### 可用上下文变量
- ctx.params — 传入的参数（通过工具的 params 字段设置）
- ctx.upstreamOutputs — 模拟的上游步骤输出（通过工具的 upstreamOutputs 字段设置）
- ctx.signal — AbortSignal（支持取消）
- ctx.browser — 浏览器操作 API（连接 Electron 内置浏览器，共享登录态和 cookie）
- fetch — 全局 fetch
- console — 日志输出（log/warn/error 会被捕获并返回在结果的 logs 数组中）

### ctx.browser 完整 API

**重要：ctx.browser 与用户看到的 Electron 浏览器是同一个实例，共享所有 tab 和登录态。Bridge 服务在 Electron 启动时就自动运行，不需要额外启动。**

**重要：click/fill 的参数是 uid（从 snapshot 获取），不是 CSS selector！waitFor 等待的是页面中的文本，不是 CSS selector！**

\`\`\`
ctx.browser.navigate(url)                     // 导航到 URL
ctx.browser.snapshot()                        // 获取页面快照 → { title, content }
                                              // content 含元素 uid，格式如 [uid=e12] <input name="email">
ctx.browser.click(uid)                        // 点击元素（uid 来自 snapshot）
ctx.browser.fill(uid, value)                  // 填充输入框（uid 来自 snapshot）
ctx.browser.type(text, submitKey?)            // 键盘输入，可选 "Enter" 等
ctx.browser.press(key)                        // 按键（"Enter"、"Tab" 等）
ctx.browser.waitFor(text, { timeout })        // 等待页面出现指定文本（字符串或字符串数组）
ctx.browser.evaluate(jsScript)                // 在浏览器页面内执行 JS 并返回结果
ctx.browser.screenshot()                      // 截图（返回文件路径）
ctx.browser.pages()                           // 列出所有 tab → [{ id, url, title }]
ctx.browser.currentPage()                     // 当前 tab 信息
ctx.browser.newPage(url?)                     // 打开新 tab → { id }
ctx.browser.selectPage(id)                    // 切换到指定 tab（id 来自 pages()）
ctx.browser.closePage(id)                     // 关闭 tab
\`\`\`

### 标准操作流程

1. 先用 pages() 看已有 tab，如果目标页已打开就用 selectPage(id) 切过去
   如果同一站点存在多个相似 tab，不要猜测，优先 newPage(url) 打开确定的新页，或在确认页面标题/URL 后再 selectPage(id)
2. 或者用 navigate(url) 打开新页面
3. 用 waitFor('关键文本') 等页面加载完成
4. 用 snapshot() 获取页面结构，从 content 中提取元素的 uid
5. 用 click(uid) / fill(uid, value) 操作表单
6. 最后 return { success: true, output: { summary: '结果描述' } }

登录、跳转、导出、慢站点加载这类场景，waitFor 不要写 10000 或 15000 这类过短超时；至少按 30000ms 处理，默认优先用 60000ms，确实是重页面时可提高到 120000ms。

### 从 snapshot 提取 uid 的方法

\`\`\`javascript
function findUid(content, hint) {
  const re = new RegExp('\\[uid=([^\\]]+)\\][^\\n]*' + hint);
  const m = content.match(re);
  return m ? m[1] : null;
}
const snap = await ctx.browser.snapshot();
const loginUid = findUid(snap.content, '登录');
if (loginUid) await ctx.browser.click(loginUid);
\`\`\`

### 调试技巧
- 先用小段代码测试单个操作，确认能跑通再组合
- navigate 后务必 waitFor 等页面加载，否则 snapshot 可能为空
- 如果目标页已经打开，用 selectPage 切过去比 navigate 更快
- console.log 的输出会在结果的 logs 数组中返回，方便调试
- 用 evaluate() 在页面内执行 JS 可以获取 DOM 数据（比如表格内容），保持登录态

### 元素找不到时的排查顺序（必须遵守）
当 snapshot 中找不到目标元素时，**严禁直接得出"能力不足"的结论**。按以下顺序排查：
1. 先用 evaluate 确认元素在 DOM 中：evaluate('document.querySelector(".xxx") ? "found" : "not found"')
2. 如果 DOM 中存在但 snapshot 没有 → 时序问题，用 waitFor 等渲染完再重新 snapshot
3. 如果 DOM 中也不存在 → 操作时序错误（弹框未触发、页面未加载等），修正前置操作
4. 只有以上全部排除后，才考虑其他原因

核心原则：**先用 evaluate 验证 DOM 事实，再下结论。不要从表象（snapshot 拿不到）跳到结论（能力不足）。**
ctx.browser 和 Agent 的浏览器 MCP 是同一个 Bridge Server，能力完全相同，没有任何限制。`;

export function buildWorkflowChatSystemPrompt(dslJson?: string): string {
  const customPrompt = getSetting('workflow_builder_system_prompt') || '';
  const basePrompt = customPrompt || WORKFLOW_REFINE_PROMPT;

  const agents = listAgentPresets();
  const agentBlock = agents.length === 0
    ? '\n\n## 可用 Agent\n(无)'
    : '\n\n## 可用 Agent\n' + agents.map(a => `- id: "${a.id}"  name: "${a.name}"  desc: "${a.description || ''}"`).join('\n');

  const dslBlock = dslJson
    ? `\n\n## 当前工作流 DSL\n${dslJson}`
    : '';

  return [
    WORKFLOW_CHAT_MARKER,
    basePrompt,
    WORKFLOW_CAPABILITIES_HINT,
    agentBlock,
    dslBlock,
  ].join('\n');
}

/** Resolve workflow builder provider ID (empty string → use session default). */
export function getWorkflowProviderId(): string {
  return getSetting('workflow_builder_provider_id') || '';
}

/** Resolve workflow builder model (empty string → use session default). */
export function getWorkflowModel(): string {
  return getSetting('workflow_builder_model') || '';
}

export function isWorkflowChatSession(
  session?: Pick<ChatSession, 'system_prompt'> | null,
): boolean {
  return Boolean(session?.system_prompt?.includes(WORKFLOW_CHAT_MARKER));
}
