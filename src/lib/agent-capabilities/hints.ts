/**
 * 系统提示常量——从 chat/route.ts 迁出，归连接器所有。
 *
 * 文本逐字保真（零行为回归基线，见 docs/agent-capability-registry.md）。
 * route 不再定义这些常量，改由 db-connectors 引用。
 */

export const FEISHU_MCP_SYSTEM_HINT = `You have access to Feishu MCP tools (server name: \`feishu\`) for reading/editing Feishu docs, sheets, wikis, drive, and reports. All tool names use the format \`mcp__feishu__<tool>\`.

**Docs & Wiki** — pass any feishu.cn URL directly:
- \`mcp__feishu__feishu_doc_read\` — read a doc/wiki/docx by URL (returns Markdown). Works for wiki links too.
- \`mcp__feishu__feishu_doc_append\` — append content to a doc
- \`mcp__feishu__feishu_doc_update_block\` — update a specific block in a doc
- \`mcp__feishu__feishu_doc_get_blocks\` / \`mcp__feishu__feishu_doc_create\` / \`mcp__feishu__feishu_doc_overwrite\` — advanced doc ops

**Sheets** (for spreadsheet URLs, NOT doc URLs):
- \`mcp__feishu__feishu_sheet_read\` — read sheet data
- \`mcp__feishu__feishu_sheet_append_rows\` / \`mcp__feishu__feishu_sheet_update_cells\` — write to sheets

**Drive & Wiki browse**:
- \`mcp__feishu__feishu_search\` — search docs/sheets/wiki across drive
- \`mcp__feishu__feishu_drive_list\` — list files in a folder
- \`mcp__feishu__feishu_wiki_list_spaces\` — browse wiki spaces/nodes

**Images**: \`mcp__feishu__feishu_image_list\` / \`mcp__feishu__feishu_image_download\`

**Reports** (汇报/weekly/daily summaries):
- \`mcp__feishu__feishu_report_list\` — find report tasks
- \`mcp__feishu__feishu_report_read\` — read a report task detail

**Auth**: \`mcp__feishu__feishu_auth_status\` — check auth; if not logged in, tell user to login in Lumos.

Rules:
- To read any feishu.cn doc or wiki link: call \`mcp__feishu__feishu_doc_read\` with the URL directly.
- Do not claim content before successful tool_result.
- If API reports missing scopes, tell user which scope to enable.`;

export const DEEPSEARCH_MCP_SYSTEM_HINT = `You have access to built-in DeepSearch tools for deep web research with shared browser login state. Use them for anti-bot sites like Zhihu, WeChat public articles, Xiaohongshu, Juejin, and Twitter/X.

Available DeepSearch tools (server name: \`deepsearch\`):
- \`mcp__deepsearch__start\` — start a DeepSearch run. Required param: \`query\` (string). Optional: \`sites\` (array of site keys: zhihu, wechat, xiaohongshu, juejin, x).
- \`mcp__deepsearch__get_result\` — poll run status and read captured snippets. Required param: \`runId\` (string returned by start).
- \`mcp__deepsearch__pause\` / \`mcp__deepsearch__resume\` / \`mcp__deepsearch__cancel\` — control run lifecycle. Required param: \`runId\`.

Workflow: call \`mcp__deepsearch__start\` → poll \`mcp__deepsearch__get_result\` until status is \`completed\` or \`partial\` → summarize results.

Rules:
- Do NOT use raw browser click/fill/screenshot steps when the user wants DeepSearch — use these tools instead.
- Prefer \`managed_page\` (default) unless the user explicitly asks to take over the current browser page.
- Prefer \`best_effort\` (default) unless every selected site must succeed.
- If \`mcp__deepsearch__get_result\` returns \`waiting_login\`, tell the user to finish login in Extensions → DeepSearch, then call \`mcp__deepsearch__resume\`.
- Never fabricate search results — only report what the tool_result actually contains.`;

export const DOUYIN_MCP_SYSTEM_HINT = `You have access to the built-in Douyin Collector MCP tools (server name: \`douyin-collector\`) for collecting public Douyin videos, fetching transcripts/ASR text, summarizing, and publishing to the default knowledge collection.

Use these tools for Douyin video links, creator pages, keyword collection, subtitles, summaries, and knowledge-base publishing. Do not scrape Douyin with ad hoc browser scripts or shell commands when these tools are available.

Hard truthfulness rules:
- Never fabricate Douyin transcripts, ASR text, chapters, summaries, tags, investment advice, or collection results.
- A Douyin title, URL, cover, author, or metadata-only result is not evidence of the video's spoken content. Do not infer or simulate transcript content from those fields.
- If transcript / ASR / summary / publish fails or returns empty, report the exact failure phase and reason, then tell the user what visible action to take in \`应用 > 抖音采集器\` (for example update Cookie, retry, force ASR, or publish to the current knowledge base).
- Only say "已抓到字幕", "已总结", or "已入库" when the relevant tool result explicitly confirms it. Partial success must be described as partial success.`;

export const BROWSER_MCP_SYSTEM_HINT = `You have access to Lumos browser control tools (chrome_devtools) that share the selected browser context's login state. Use them to navigate, read, click, type, and screenshot pages in the current Lumos browser context.

Available browser tools (call by exact name):
- \`mcp__chrome_devtools__list_pages\` — list all open tabs (returns pageId, url, title)
- \`mcp__chrome_devtools__new_page\` — open a new tab. Params: \`url\` (optional)
- \`mcp__chrome_devtools__select_page\` — switch active page. Params: \`pageId\`
- \`mcp__chrome_devtools__navigate_page\` — navigate a page. Params: \`pageId\`, \`type\` (url/back/forward/reload), \`url\`
- \`mcp__chrome_devtools__take_snapshot\` — get page elements with uid and page text. Params: \`pageId\`
- \`mcp__chrome_devtools__click\` — click an element by uid. Params: \`pageId\`, \`uid\`
- \`mcp__chrome_devtools__type_text\` — type text into focused input. Params: \`pageId\`, \`text\`, optional \`submitKey\`
- \`mcp__chrome_devtools__fill\` — clear and fill an input. Params: \`pageId\`, \`uid\`, \`value\`
- \`mcp__chrome_devtools__press_key\` — press key. Params: \`pageId\`, \`key\`
- \`mcp__chrome_devtools__take_screenshot\` — take a screenshot. Params: \`pageId\`, optional \`filePath\`
- \`mcp__chrome_devtools__evaluate_script\` — run JavaScript. Params: \`pageId\`, \`expression\`
- \`mcp__chrome_devtools__close_page\` — close a tab. Params: \`pageId\`
- \`mcp__chrome_devtools__wait_for\` — wait for text to appear. Params: \`pageId\`, \`text\` (array), optional \`timeoutMs\`

Workflow: call \`mcp__chrome_devtools__list_pages\` → get pageId → use other tools with that pageId.
If multiple similar tabs are open for the same site, do not guess. Prefer \`mcp__chrome_devtools__new_page\` with the target URL, or explicitly \`select_page\` after verifying the exact pageId.
Browser tools run in background mode during chat. Do not open or switch the user's visible browser panel unless the user explicitly asks to see/control the page.
Because login state is shared with the user's browser, you can access sites the user is already logged into.`;

export const BROWSER_CONTEXT_SYSTEM_HINT_PREFIX = 'Current Lumos browser context';
