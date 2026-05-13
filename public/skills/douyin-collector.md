---
name: douyin-collector
description: 给 AI 使用抖音采集、字幕、总结、关键词/博主批量采集和默认知识库入库能力
---

# 抖音采集器 / Douyin Collector

当用户要采集、整理、总结抖音公开视频，或者按博主 / 关键词批量收集内容时，优先使用 `douyin-collector` MCP。不要自己写脚本抓抖音页面，也不要绕过抖音采集器直接操作数据库。

## 决策规则

- 单条视频采集 + 默认处理：用 `douyin_collect_video`。默认会采集、抓字幕/转写、总结，并写入默认知识库。
- 已有视频只要总结：用 `douyin_summarize_video`。默认不入库；用户明确要求入库时设置 `publish_to_knowledge=true`。
- 已有视频要完整处理：用 `douyin_process_video`。默认会抓字幕/转写、总结，并写入默认知识库。
- 按关键词采集：用 `douyin_search_keyword`。它会创建或复用关键词订阅并立即执行一次采集，默认会继续抓字幕、总结并入库；只要元数据时设置 `auto_process=false`。
- 按单个博主采集：用 `douyin_collect_creator`。
- 批量博主 / 关键词 / 链接采集：用 `douyin_batch_collect`。默认只采集元数据，避免大批量 ASR 产生费用；用户明确要求“总结 / 入库 / 处理这批”时设置 `auto_process=true`。
- 只抓字幕：用 `douyin_get_subtitle`。

## 重要边界

- `skill` 只负责告诉 AI 怎么选工具；真正执行必须走 MCP。
- 不要声称已绕过抖音风控、验证码或登录限制。
- 不要在工具失败时编造视频标题、字幕、总结、销量或采集结果。
- 不要用 Bash / Python / 浏览器脚本直接抓抖音来替代 MCP；错误要回传给用户。

## 成本和批量策略

批量处理可能触发大量 ASR / 总结 / 入库调用。除非用户明确说要“总结这批”“入库这批”“处理这批”，否则 `douyin_batch_collect` 保持默认 `auto_process=false`。

如果用户明确要求总结或入库：

```json
{
  "tool": "douyin_batch_collect",
  "arguments": {
    "creators": ["<sec_uid 或主页链接>"],
    "keywords": ["AI 赚钱"],
    "auto_process": true,
    "publish_to_knowledge": true
  }
}
```

## 错误处理

- 返回 `Cookie` / `登录` / `风控` / `验证` 相关错误：告诉用户去 `应用 > 抖音采集器 > 设置` 更新 Cookie 或完成登录状态检查。
- 返回 `未找到默认知识库 collection`：告诉用户先在抖音采集器设置默认知识库，或本次把 `publish_to_knowledge=false`。
- 批量结果里有 `failures`：明确说明哪些目标失败、哪些成功，不要只说“已完成”。
- 返回 `ok:false`：按原始 `phase` 和 `error` 解释，不要包装成成功。

## 回复口径

成功时说明采集了多少视频、是否已总结、是否已入库。部分成功时必须写清失败数量和失败原因。工具不可用时直接说“抖音采集器 MCP 未就绪”，不要换成自制采集方案。
