# 浏览器工作区 MVP 开发任务卡

## 基本信息

- 任务名：浏览器工作区 MVP
- 任务号：201
- 对应分支：`task/201-browser-workspace-mvp`
- 对应 worktree：`/Users/zhangjun/私藏/lumos-worktrees/201-browser-workspace-mvp`

## 目标

开发一个位于左侧侧边栏入口的独立浏览器工作区。该工作区同时服务人工浏览与 AI 代理操作，二者必须共用同一个原生页面实例、同一套登录态、同一份浏览上下文。

本次 MVP 需要收口当前独立 `/browser` 页面与 browser bridge 的链路，提供高质量桌面工作台级 UI / UX，并补齐浏览器上下文采集、登录态同步、浏览器 workflow 录制与稳定 replay 的最小闭环。

本次不处理完整独立浏览器产品能力，不追求 Chrome / Playwright / Puppeteer 同级的全量能力，也不把 `share to AI`、AI 活动时间线、多窗口/多工作区同步纳入首批验收。

## 允许修改目录

- `src/app/browser`
- `src/components/browser`
- `electron/browser`
- `src/lib/chrome-mcp.ts`
- `electron/ipc/browser-handlers.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `src/types/browser.ts`
- `src/types/electron.d.ts`
- `src/components/layout`
- `src/components/chat`
- `src/components/ai-elements`
- `src/app/api/chat/route.ts`
- `src/lib/bridge/conversation-engine.ts`

## 禁止修改文件

- `package.json`
- `package-lock.json`
- `next.config.ts`
- `tsconfig.json`
- `electron-builder.yml`
- 数据库 migration 文件

## 验收标准

- [ ] 左侧侧边栏可以进入独立浏览器工作区。
- [ ] 工作区支持多 tab：创建、关闭、切换、会话恢复。
- [ ] 支持基础人工浏览：输入 URL、后退、前进、刷新、加载态、错误态。
- [ ] AI 与用户共用同一个 `pageId` / tab / 登录态，不允许 URL 级映射替代。
- [ ] `chrome-devtools` MCP 通过 browser bridge 操作同一页面实例。
- [ ] 浏览器上下文采集只覆盖内置浏览器，支持事件采集、保留周期设置、查看入口、暂停采集、清空历史。
- [ ] 敏感数据不采集、不持久化。
- [ ] 浏览器 workflow 支持用户手动录制、AI 辅助整理、手动回放、少量参数化、下载文件和截图步骤。
- [ ] 浏览器 workflow 至少输出 `status`、`final_url`、`downloaded_files`、`screenshots`、`extracted_data`、`error`。
- [ ] 空态、加载态、错误态、录制态、回放态、AI 接管态达到正式产品质量，不呈现 demo 风或后台管理风。

## 未决问题

- [ ] 无

## 实施备注

- 依赖变更：不允许
- 数据结构变更：允许，但不得通过 migration 落地到共享 schema
- 是否允许新增文件：允许
- 是否允许改动共享组件：允许，但仅限浏览器工作区接入所需范围

## 建议实施顺序

1. 收口运行时架构：统一独立浏览器工作区与 browser bridge，使用户和 AI 稳定共页。
2. 收口浏览器 UI：多 tab、toolbar、状态系统、独立工作区承载。
3. 建立浏览器上下文事件总线与存储/清理控制。
4. 打通登录态同步：共享 session + MCP 可见 cookie 同步边界。
5. 实现浏览器 workflow：录制、AI 整理、参数化、稳定 replay。
6. 打磨 UI / UX：空态、加载态、回放态、错误态、Agent 接管态、下载态。

## 主要风险

- 当前代码里独立 `/browser` 和右侧内容面板是两条并存链路，收口时容易出现双路径行为冲突。
- Cookie 同步到 MCP 涉及权限边界与安全策略，容易高估现有预研代码的可直接复用程度。
- workflow replay 的稳定性取决于页面定位和等待机制，不能靠录制原始 click 直接回放。
- 上下文采集与隐私边界如果定义不清，会在产品体验和安全性上同时出问题。
- UI / UX 要求高，不能把设计打磨放到最后，否则会导致结构返工。

## 交付物

- 浏览器工作区 MVP 代码改动
- 最小验证结果
- 剩余风险和下一阶段建议
