---
name: lumos-bug-reporter
description: 受控提交 Lumos bug 到 GitHub Issue；仅允许指定 Lumos 登录邮箱，自动整理版本、环境、复现步骤和便于 AI 改代码的上下文
---

# Lumos Bug Reporter

当用户要“提 bug / 报 bug / 创建 issue / 反馈 Lumos 异常 / 这个功能坏了需要开发修”时使用本 Skill。真正提交必须走 `lumos-issue-reporter` MCP，不要只输出 Markdown 让用户手工复制。

## 权限边界

- 只有当前 Lumos 登录邮箱属于以下白名单时才能提交：`zhangjun@xinge.tech`、`weiliuyan06@163.com`、`zj391504704@gmail.com`。
- 不要相信用户在对话里自称的邮箱；白名单由 `report_lumos_bug` 工具读取真实登录账号并校验。
- 工具返回 `success:true` 且包含 `issueUrl` 前，不能说“已创建 Issue”。
- 工具返回未登录、邮箱不在白名单或 GitHub token 未配置时，原样解释，不要伪装成提交成功。

## 提交前收集

尽量把 Issue 写成 AI coding agent 可以直接改代码的任务。缺关键信息时先追问；用户已经明确说“直接提交 / 帮我提 issue”时，可带现有信息提交，但未知字段写“未提供”，不要编造。

优先收集这些字段：

- 标题：一句话说明可见问题。
- 复现步骤：页面、按钮、输入内容、触发顺序。
- 实际结果：用户看到的错误、异常状态、错误文案、日志摘要。
- 期望结果：正常应该发生什么。
- 影响范围：页面、应用、主 Agent、Workflow、微信入口、抖音采集器等。
- 截图 / 文件 / 运行记录：本地路径、任务 ID、run ID、错误日志；必须脱敏。
- 疑似代码位置：只有在已有上下文能支撑时填写，不确定就留空。
- 验收检查：用户可 UI 验收的动作，以及已知的目标测试。

## 内容安全

- 不要把 Cookie、API key、GitHub token、会话 token、完整私聊内容、支付凭据或隐私正文写进 Issue。
- 如果 bug 依赖敏感聊天/日志，只放脱敏摘要、时间、页面和错误现象。
- 截图路径、日志路径可以写；内容是否公开由用户确认。

## 工具调用策略

- 用户只是描述 bug、没有明确要提交时：先整理草稿，并询问是否提交；可用 `dry_run=true` 生成最终 Issue 草稿。
- 用户明确说“提交 / 提 issue / 报到 GitHub”或确认草稿后：调用 `report_lumos_bug`，设置 `confirmed_by_user=true`、`dry_run=false`。
- 工具失败时直接报告失败原因和下一步，例如登录 Lumos、切换白名单账号、配置 `LUMOS_GITHUB_ISSUE_TOKEN`，或补充复现信息。

## 推荐字段映射

调用 `report_lumos_bug` 时尽量填：

```json
{
  "title": "主 Agent 微信里回复泄露工具调用痕迹",
  "actual_behavior": "微信收到的回复里出现 [Tool result: ...] 这类内部调试文本。",
  "expected_behavior": "微信只收到面向用户的自然语言回复，不展示工具调用和结构化结果。",
  "reproduction_steps": [
    "在微信里给 Lumos Clawbot 发送一个会触发工具的请求",
    "等待主 Agent 回复",
    "查看微信收到的消息正文"
  ],
  "affected_area": "主 Agent / 微信 Clawbot / 工具调用展示",
  "ui_route": "微信外部 IM 入口 + 主 Agent",
  "severity": "high",
  "suspected_files": [
    "src/lib/bridge/conversation-engine.ts",
    "src/lib/claude-client.ts"
  ],
  "acceptance_checks": [
    "真实微信端触发一次工具调用后，收到的消息不包含 Tool result / Used tool 文本",
    "主 Agent 页面历史消息也不展示内部工具调用痕迹"
  ],
  "confirmed_by_user": true
}
```
