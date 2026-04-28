"""Tiny JSON-in/JSON-out CLI for the lumos UI.

Reuses server.py's internal helpers — same data path, same env vars,
same caches — but exposes structured data instead of the formatted
strings the AI tools return.

Wire:
    echo '{"op":"list_contacts","args":{"query":"刘"}}' | python api.py

The response is one JSON object on stdout; errors go to stderr and exit 1.
"""
from __future__ import annotations

import glob as _glob
import hashlib
import json
import os
import sys
import time
import xml.etree.ElementTree as ET

import server  # noqa: E402  (sibling module)
from message_decoder import _maybe_decompress, decode_content  # noqa: E402

MSG_TYPE_PLACEHOLDERS = {
    "3": "[图片]",
    "34": "[语音]",
    "43": "[视频]",
    "47": "[表情]",
    "49": "[链接/卡片]",
    "10000": "[系统]",
    "10002": "[系统]",
}


def _attach_dir_for_chat(wxid: str) -> str:
    """`~/Library/.../msg/attach/<md5(wxid)>` — folder containing image/video subdirs."""
    chat_md5 = hashlib.md5(wxid.encode()).hexdigest()
    db_dir = server._find_data_dir()  # …/db_storage
    user_dir = os.path.dirname(db_dir)  # …/<wxid>_xxxx
    return os.path.join(user_dir, "msg", "attach", chat_md5)


def _parse_image_meta(content_raw: object) -> dict:
    """Pull `length` (bytes) out of an image-message XML payload.

    The XML is zstd-compressed in the message_content column. `length` is
    the only attribute we actually use for matching local files — md5 is
    a CDN identifier that doesn't appear locally.
    """
    if not content_raw:
        return {}
    raw = content_raw if isinstance(content_raw, (bytes, bytearray)) else str(content_raw).encode("latin-1", errors="ignore")
    try:
        decompressed = _maybe_decompress(bytes(raw)).decode("utf-8", errors="ignore")
    except Exception:
        return {}
    try:
        root = ET.fromstring(decompressed.replace('\x00', ''))
    except ET.ParseError:
        return {}
    img = root.find(".//img")
    if img is None:
        return {}
    return {
        "length": int(img.get("length") or 0),
        "md5": img.get("md5") or "",
    }


def _resolve_image_path(wxid: str, ts: int, length: int) -> str | None:
    """Find the local _M.dat for an image message by (mtime, file_size).

    WeChat 4.x macOS stores images at:
        attach/<md5(wxid)>/<yyyy-mm>/Img/<localprefix>_M.dat

    The XML's md5 attribute is the CDN hash and does NOT match local files.
    But mtime tracks the message's create_time second-by-second, and
    `length` from XML matches the on-disk file size for ~99% of cases.

    Strategy: list the chat's same-month Img/ folder, prefer files where
    mtime == ts; tiebreak by size match.
    """
    if not ts:
        return None
    chat_dir = _attach_dir_for_chat(wxid)
    yyyy_mm = time.strftime("%Y-%m", time.localtime(ts))
    img_dir = os.path.join(chat_dir, yyyy_mm, "Img")
    if not os.path.isdir(img_dir):
        return None

    candidates = []
    for path in _glob.glob(os.path.join(img_dir, "*_M.dat")):
        try:
            st = os.stat(path)
        except OSError:
            continue
        candidates.append((path, int(st.st_mtime), st.st_size))

    # Prefer same-second match; fall back to closest mtime within 60s.
    exact = [c for c in candidates if c[1] == ts]
    if length:
        for cand in exact:
            if cand[2] == length:
                return cand[0]
    if exact:
        return exact[0][0]
    near = [c for c in candidates if abs(c[1] - ts) <= 60]
    if length:
        for cand in near:
            if cand[2] == length:
                return cand[0]
    if near:
        near.sort(key=lambda c: abs(c[1] - ts))
        return near[0][0]
    return None


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

            ts_int = int(create_time) if str(create_time).isdigit() else 0
            entry: dict = {
                "ts": ts_int,
                "sender": "me" if is_me else "them",
                "type": low_type,
                "type_label": MSG_TYPE_PLACEHOLDERS.get(str(low_type), ""),
                "content": rendered,
            }
            # Image messages: probe the local file so the UI can render it
            # via the /api/wechat-export/image route.
            if low_type == 3:
                meta = _parse_image_meta(content_raw)
                local = _resolve_image_path(wxid, ts_int, meta.get("length") or 0)
                if local:
                    entry["has_image"] = True
            messages.append(entry)

    messages.sort(key=lambda m: m["ts"])
    return {
        "wxid": wxid,
        "display": display,
        "messages": messages[-limit:] if limit else messages,
        "total": len(messages),
    }


def resolve_image(args: dict) -> dict:
    """Return the absolute path of the image file for a (wxid, ts) pair.

    The /api/wechat-export/image route uses this to translate a message
    into bytes on disk. We re-run the message lookup to read `length`
    from the XML payload (file_size match is more robust than mtime
    alone when there are multiple images in the same second).
    """
    wxid = (args.get("wxid") or "").strip()
    ts = int(args.get("ts") or 0)
    if not wxid or not ts:
        return {"error": "wxid + ts required"}

    table = f"Msg_{hashlib.md5(wxid.encode()).hexdigest()}"
    for db_path in server._get_message_dbs():
        existing = server._query_raw(
            db_path,
            f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}';",
        )
        if not [t.strip() for t in existing if t.strip()]:
            continue
        rows = server._query(
            db_path,
            f"SELECT message_content FROM {table} "
            f"WHERE create_time = {ts} AND local_type & 0xFFFF = 3 LIMIT 1;",
        )
        if not rows:
            continue
        meta = _parse_image_meta(rows[0].get("message_content", ""))
        local = _resolve_image_path(wxid, ts, meta.get("length") or 0)
        if local:
            return {"path": local}
        return {"error": "file_not_found"}

    return {"error": "message_not_found"}


OPS = {
    "list_contacts": list_contacts,
    "read_chat": read_chat,
    "resolve_image": resolve_image,
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
