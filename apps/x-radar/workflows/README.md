# X 雷达 — workflow 设计文档（非运行时）

这 4 个 JSON 文件是 X 雷达 4 个任务模板的 **执行流程设计文档**，按 Lumos `AppWorkflow` v2 schema 写。
它们 **不在运行时被工作流引擎调度** — 安装后 Lumos 不会把这些 workflow 注册到 OpenWorkflow runtime。

**真实运行时实现** 在：
- `src/lib/x-radar/patrol.ts` — 入口 / cadence / queue
- `src/lib/x-radar/patrol-monitor.ts` — 监控雷达（X 抓取 + 规则匹配 + IM 推送）
- `src/lib/x-radar/patrol-ai.ts` — 选题/摘要/拆解（X 抓取 + LLM 报告生成）

调度入口：`src/lib/app/native-automation-runner.ts` 里 `x-radar:run-*-tasks` 4 个 `native_action`，由 `app_automations` 表的「自动化」触发。

保留这些 JSON 文件的原因：
1. 给后续接 workflow 引擎驱动留口子
2. 文档化每个模板的 step 拆解，方便排查 patrol 实现是否漂移
