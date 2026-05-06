"""Windows WeChat MCP server for Lumos."""
from __future__ import annotations

import time
from datetime import datetime

from mcp.server.fastmcp import FastMCP

import api

mcp = FastMCP(
    "wechat",
    instructions=(
        "Windows 微信聊天记录读取与分析工具。可以列出聊天对话、读取消息内容、"
        "搜索关键词、获取最近消息。所有数据库解密与查询都在用户本机完成。"
    ),
)


def _fmt_time(ts: int) -> str:
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "未知时间"


def _find_contact(text: str) -> list[dict]:
    text = (text or "").strip()
    if not text:
        return []
    sessions = api.list_sessions({"limit": 500}).get("items", [])
    exact = [item for item in sessions if item.get("wxid") == text or item.get("display") == text]
    if exact:
        return exact
    needle = text.lower()
    matched = []
    for item in sessions:
        haystack = " ".join(str(item.get(key, "")) for key in ["wxid", "display", "nickname", "remark"]).lower()
        if needle in haystack:
            matched.append(item)
    if matched:
        return matched
    return api.list_contacts({"query": text, "limit": 20}).get("items", [])


@mcp.tool()
def wechat_list_chats(limit: int = 100) -> str:
    """列出最近微信聊天会话。"""
    data = api.list_sessions({"limit": limit})
    items = data.get("items", [])
    if not items:
        return "未找到任何微信会话"
    lines = [f"共 {len(items)} 个最近会话:"]
    for item in items:
        display = item.get("display") or item.get("wxid")
        wxid = item.get("wxid")
        summary = item.get("summary") or ""
        ts = _fmt_time(item.get("last_timestamp") or 0)
        lines.append(f"  {display} (wxid: {wxid}) [{ts}] {summary}")
    return "\n".join(lines)


@mcp.tool()
def wechat_read_chat(contact: str, limit: int = 50, days: int = 7) -> str:
    """读取与指定联系人/群聊的微信聊天记录。"""
    matched = _find_contact(contact)
    if not matched:
        return f"未找到匹配 '{contact}' 的联系人。请先用 wechat_list_chats 查看会话。"
    if len(matched) > 5:
        lines = [f"匹配 '{contact}' 的联系人太多，请更精确:"]
        for item in matched[:10]:
            lines.append(f"  {item.get('display')} (wxid: {item.get('wxid')})")
        return "\n".join(lines)

    since = int(time.time()) - days * 86400
    sections = []
    for item in matched:
        wxid = item.get("wxid")
        display = item.get("display") or wxid
        data = api.read_chat({"wxid": wxid, "limit": limit})
        messages = [msg for msg in data.get("messages", []) if int(msg.get("ts") or 0) >= since]
        sections.append(f"\n=== 与 {display} 的对话 (wxid: {wxid}) ===")
        if not messages:
            sections.append(f"最近 {days} 天没有读到消息")
            continue
        for msg in messages[-limit:]:
            direction = "[我]" if msg.get("sender") == "me" else "[对方]"
            sections.append(f"  [{_fmt_time(msg.get('ts') or 0)}] {direction} {msg.get('content') or ''}")
    return "\n".join(sections)


@mcp.tool()
def wechat_recent_messages(days: int = 3, limit: int = 100) -> str:
    """获取最近几天所有微信会话的消息概览。"""
    sessions = api.list_sessions({"limit": 50}).get("items", [])
    since = int(time.time()) - days * 86400
    lines = [f"最近 {days} 天微信消息概览:"]
    count = 0
    for item in sessions:
        if count >= limit:
            break
        wxid = item.get("wxid")
        display = item.get("display") or wxid
        data = api.read_chat({"wxid": wxid, "limit": 10})
        messages = [msg for msg in data.get("messages", []) if int(msg.get("ts") or 0) >= since]
        if not messages:
            continue
        lines.append(f"\n--- {display} ---")
        for msg in messages[-5:]:
            if count >= limit:
                break
            direction = "[我]" if msg.get("sender") == "me" else "[对方]"
            lines.append(f"  [{_fmt_time(msg.get('ts') or 0)}] {direction} {msg.get('content') or ''}")
            count += 1
    return "\n".join(lines) if count else f"最近 {days} 天没有读到消息"


@mcp.tool()
def wechat_search_messages(keyword: str, days: int = 30, limit: int = 50) -> str:
    """在微信聊天记录中搜索关键词。"""
    rows = api.search_messages(keyword, days=days, limit=limit)
    if not rows:
        return f"未找到包含 '{keyword}' 的消息"
    contacts = api.list_contacts({"limit": 10000}).get("items", [])
    names = {item.get("wxid"): item.get("display") for item in contacts}
    lines = [f"搜索 '{keyword}' 找到 {len(rows)} 条消息:"]
    for row in rows:
        display = names.get(row.get("wxid"), row.get("wxid"))
        direction = "[我]" if row.get("sender") == "me" else "[对方]"
        lines.append(f"  [{_fmt_time(row.get('ts') or 0)}] {display} {direction}: {row.get('content') or ''}")
    return "\n".join(lines)


@mcp.tool()
def wechat_chat_summary(days: int = 3) -> str:
    """生成最近微信聊天的简要摘要输入。"""
    return wechat_recent_messages(days=days, limit=120)


if __name__ == "__main__":
    mcp.run()
