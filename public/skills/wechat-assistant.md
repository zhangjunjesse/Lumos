---
name: wechat-assistant
description: 给 AI 使用微信消息检索、聊天记录读取、跟进事项、自动化和群总结能力（经 lumos-wechat-assistant MCP）
---

# 微信助手 / WeChat Assistant

当用户要查微信消息、读某个联系人或群的聊天记录、做微信跟进、看/改微信自动化或群每日总结时，**优先使用 `lumos-wechat-assistant` MCP 工具**。Lumos 一定装了微信能力——这些工具在任何聊天模式下都在；不要因为没看到"微信 Skill 之外的东西"就说自己没有微信能力。

## 决策规则

- 按关键词找消息：用 `mcp__lumos-wechat-assistant__search_wechat_messages`（先同步镜像再搜）。
- 读某个联系人/群的最近或全部消息：用 `mcp__lumos-wechat-assistant__read_wechat_chat`，不要用关键词搜联系人名来代替。
- 不确定微信数据是否就绪：先调 `mcp__lumos-wechat-assistant__get_wechat_assistant_status`，按同步状态如实说明。
- 跟进事项：`list_wechat_followups` / `create_wechat_followup` / `complete_wechat_followup` / `delete_wechat_followup`；用户报标题先 `resolve_wechat_followup` 定位 id，别猜。
- 自动化/每日总结：`list_wechat_automations` / `create_wechat_automation` / `trigger_wechat_automation` / `update_wechat_automation` / `set_wechat_automation_enabled` / `diagnose_wechat_automation`；用户报名称先 `resolve_wechat_automation`。
- 转发某条自动化已生成的报告：先 `read_wechat_automation_report` 取 `report_markdown` 原文转发，不要重新搜消息另生成一份更轻的总结。
- 群标签/工作群范围：`list_wechat_group_tags` / `preview_wechat_group_tag` / `summarize_wechat_groups`。

## 重要边界

- `skill` 只负责告诉 AI 怎么选工具；真正执行必须走 `lumos-wechat-assistant` MCP。
- **绝不**把闲鱼（`goofish_*`）、抖音或其他平台工具当微信用。用户说"微信"就用微信工具；没有对应微信工具时如实说，不要抓最像的工具替代。
- 不要调用原始 `wechat-export` 工具（如 `wechat_read_chat`）——那是底层后端，会碰到锁库、分页契约不一致；统一走 `lumos-wechat-assistant`。
- 普通 Agent Chat 是只读：可搜可读微信历史；发消息/改自动化/改跟进等写操作只在微信助手专属会话或明确确认的写路径执行，否则向用户说明在哪里操作。
- 不要暴露原始 wxid/openim/chatroom id，除非用户明确要技术细节。

## 错误处理

- `get_wechat_assistant_status` 显示未同步 / 同步失败：如实说明，并告诉用户去「能力 → 微信」完成授权与密钥提取，不要假装没有微信能力，也不要换平台。
- 工具报同步失败：解释该结果，不要把旧的不完整结果当完整结果。
- `has_more=true`：用 `next_offset` 或更早 `before_ts` 继续翻页，不要谎称只有 200 条上限。

## 回复口径

成功时说明搜到/读到多少条、来自哪些会话、时间范围。数据未就绪时说清"微信镜像未同步，请去能力→微信授权"。工具不可用时直接说"微信助手 MCP 未就绪"，不要换成自制方案或其他平台工具。
