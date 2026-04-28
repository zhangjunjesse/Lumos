"""Tiny JSON-in/JSON-out CLI for the lumos UI.

Reuses server.py's internal helpers — same data path, same env vars,
same caches — but exposes structured data instead of the formatted
strings the AI tools return.

Wire:
    echo '{"op":"list_contacts","args":{"query":"刘"}}' | python api.py

The response is one JSON object on stdout; errors go to stderr and exit 1.
"""
from __future__ import annotations

import hashlib
import json
import sys
import time

import server  # noqa: E402  (sibling module)
from message_decoder import decode_content  # noqa: E402

MSG_TYPE_PLACEHOLDERS = {
    "3": "[图片]",
    "34": "[语音]",
    "43": "[视频]",
    "47": "[表情]",
    "49": "[链接/卡片]",
    "10000": "[系统]",
    "10002": "[系统]",
}


def _display_name(wxid: str, info: dict) -> str:
    return info.get("remark") or info.get("nickname") or wxid


def list_contacts(args: dict) -> dict:
    query = (args.get("query") or "").lower().strip()
    limit = int(args.get("limit") or 200)

    contacts = server._load_contacts()
    items: list[dict] = []
    for wxid, info in contacts.items():
        display = _display_name(wxid, info)
        if query:
            haystack = f"{wxid} {display} {info.get('nickname', '')} {info.get('remark', '')}".lower()
            if query not in haystack:
                continue
        items.append({
            "wxid": wxid,
            "display": display,
            "nickname": info.get("nickname", ""),
            "remark": info.get("remark", ""),
            "has_remark": bool(info.get("remark")),
        })

    # Sort: contacts with custom remarks first (the people user actually cares
    # about), then by display name. No DB query — sub-millisecond on 24K rows.
    items.sort(key=lambda x: (not x["has_remark"], x["display"].lower()))

    return {"items": items[:limit], "total": len(items)}


def read_chat(args: dict) -> dict:
    wxid = (args.get("wxid") or "").strip()
    days = int(args.get("days") or 30)
    limit = int(args.get("limit") or 200)
    if not wxid:
        return {"error": "wxid required", "messages": []}

    table = f"Msg_{hashlib.md5(wxid.encode()).hexdigest()}"
    cutoff = int(time.time()) - days * 86400

    contacts = server._load_contacts()
    info = contacts.get(wxid, {})
    display = _display_name(wxid, info)

    messages: list[dict] = []
    for db_path in server._get_message_dbs():
        existing = server._query_raw(
            db_path,
            f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}';",
        )
        if not [t.strip() for t in existing if t.strip()]:
            continue

        rows = server._query(
            db_path,
            f"SELECT local_id, create_time, local_type, real_sender_id, message_content "
            f"FROM {table} WHERE create_time > {cutoff} "
            f"ORDER BY create_time DESC LIMIT {limit};",
        )
        for row in rows:
            create_time = row.get("create_time") or "0"
            raw_type = row.get("local_type") or ""
            try:
                type_int = int(raw_type) if raw_type else 0
            except (ValueError, TypeError):
                type_int = 0
            low_type = type_int & 0xFFFF

            sender_id = row.get("real_sender_id", "")
            is_me = server._is_my_message(sender_id, db_path)

            content_raw = row.get("message_content", "") or ""
            if low_type in (10000, 10002):
                rendered = "[系统消息]"
            else:
                rendered = decode_content(type_int, content_raw)

            messages.append({
                "ts": int(create_time) if str(create_time).isdigit() else 0,
                "sender": "me" if is_me else "them",
                "type": low_type,
                "type_label": MSG_TYPE_PLACEHOLDERS.get(str(low_type), ""),
                "content": rendered,
            })

    messages.sort(key=lambda m: m["ts"])
    return {
        "wxid": wxid,
        "display": display,
        "messages": messages[-limit:] if limit else messages,
        "total": len(messages),
    }


OPS = {
    "list_contacts": list_contacts,
    "read_chat": read_chat,
}


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as err:
        sys.stderr.write(f"invalid json: {err}\n")
        return 1

    op = payload.get("op")
    if op not in OPS:
        sys.stderr.write(f"unknown op: {op!r} (supported: {list(OPS)})\n")
        return 1

    try:
        result = OPS[op](payload.get("args") or {})
    except Exception as err:  # noqa: BLE001  surface as JSON error
        sys.stderr.write(f"{type(err).__name__}: {err}\n")
        return 1

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
