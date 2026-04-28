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

import csv
import io
import subprocess

import server  # noqa: E402  (sibling module)
from message_decoder import _maybe_decompress, decode_content  # noqa: E402

CACHE_DIR = os.path.dirname(
    os.environ.get(
        "LUMOS_WECHAT_EXPORT_KEY_FILE",
        os.path.expanduser("~/.lumos/wechat-export/key.txt"),
    )
)
AVATAR_DIR = os.path.join(CACHE_DIR, "avatars")
KEYS_JSON_PATH = os.path.join(CACHE_DIR, "wechat_keys.json")


def _load_keys_json() -> dict:
    """All per-salt SQLCipher keys recovered during the extract-key step."""
    if not os.path.exists(KEYS_JSON_PATH):
        return {}
    try:
        with open(KEYS_JSON_PATH, "r") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {}


def _key_for_db(db_path: str) -> str | None:
    """Look up the SQLCipher key that decrypts a specific .db by its salt."""
    if not os.path.exists(db_path):
        return None
    try:
        with open(db_path, "rb") as fh:
            salt = fh.read(16).hex()
    except OSError:
        return None
    return _load_keys_json().get(salt)


def _query_with_key(db_path: str, key: str, sql: str) -> list[dict]:
    """Run a CSV SELECT against any SQLCipher db (not just the message db)."""
    cmd = (
        f"PRAGMA key = \"x'{key}'\";\n"
        "PRAGMA cipher_compatibility = 4;\n"
        "PRAGMA cipher_page_size = 4096;\n"
        ".headers on\n.mode csv\n"
    ) + sql
    try:
        result = subprocess.run(
            [server.SQLCIPHER_PATH, db_path],
            input=cmd.encode(), capture_output=True, timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    text = result.stdout.decode("utf-8", errors="replace").strip()
    if not text:
        return []
    lines = text.split("\n")
    while lines and lines[0].strip() == "ok":
        lines.pop(0)
    if len(lines) < 2:
        return []
    return list(csv.DictReader(io.StringIO("\n".join(lines))))

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
    """Search across all 24K+ contacts. Used when user types in the search box."""
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

    items.sort(key=lambda x: (not x["has_remark"], x["display"].lower()))
    return {"items": items[:limit], "total": len(items)}


SESSION_DB_PATH = lambda: os.path.join(server._find_data_dir(), "session", "session.db")  # noqa: E731


def _summary_for_msg_type(raw: str, msg_type: int) -> str:
    """Cleaner one-line preview for non-text last messages."""
    raw = (raw or "").strip()
    if msg_type == 1:
        return raw[:60] + ("…" if len(raw) > 60 else "")
    if msg_type == 3:
        return "[图片]"
    if msg_type == 34:
        return "[语音]"
    if msg_type == 43:
        return "[视频]"
    if msg_type == 47:
        return "[表情]"
    if msg_type == 49:
        return "[链接/卡片]"
    if msg_type in (10000, 10002):
        return raw[:60] or "[系统消息]"
    return raw[:60] if raw else "[不支持的消息]"


def list_sessions(args: dict) -> dict:
    """Recent chat sessions, ordered by last activity (matches WeChat's main list)."""
    limit = int(args.get("limit") or 100)

    db_path = SESSION_DB_PATH()
    key = _key_for_db(db_path)
    if not key:
        return {"items": [], "total": 0, "error": "session_db_unavailable"}

    rows = _query_with_key(
        db_path, key,
        "SELECT username, summary, sort_timestamp, last_msg_type, type, unread_count "
        f"FROM SessionTable WHERE is_hidden=0 ORDER BY sort_timestamp DESC LIMIT {limit};",
    )

    contacts = server._load_contacts()
    items: list[dict] = []
    for row in rows:
        wxid = (row.get("username") or "").strip()
        if not wxid:
            continue
        info = contacts.get(wxid, {})
        display = _display_name(wxid, info)
        # Group chats whose name isn't in contact table show as "群聊(<id>)"
        if not info and wxid.endswith("@chatroom"):
            display = f"群聊({wxid.split('@')[0]})"

        try:
            ts = int(row.get("sort_timestamp") or 0)
        except (ValueError, TypeError):
            ts = 0
        try:
            msg_type = int(row.get("last_msg_type") or 0)
        except (ValueError, TypeError):
            msg_type = 0
        try:
            unread = int(row.get("unread_count") or 0)
        except (ValueError, TypeError):
            unread = 0

        items.append({
            "wxid": wxid,
            "display": display,
            "nickname": info.get("nickname", ""),
            "remark": info.get("remark", ""),
            "has_remark": bool(info.get("remark")),
            "summary": _summary_for_msg_type(row.get("summary") or "", msg_type),
            "last_timestamp": ts,
            "last_msg_type": msg_type,
            "unread_count": unread,
            "is_group": wxid.endswith("@chatroom"),
        })

    return {"items": items, "total": len(items)}


# ─── Avatars ──────────────────────────────────────────────────────────────

def _avatar_path(wxid: str) -> str:
    safe = wxid.replace("/", "_").replace("\\", "_")
    return os.path.join(AVATAR_DIR, f"{safe}.bin")


def _ensure_avatar_extracted(wxid: str) -> str | None:
    """Pull avatar bytes from head_image.db and cache to disk; idempotent.

    Returns the local path on success, None when the contact has no avatar
    on this device. We extract one wxid at a time (cheap: indexed lookup).
    """
    if not wxid:
        return None
    path = _avatar_path(wxid)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path

    db_path = os.path.join(server._find_data_dir(), "head_image", "head_image.db")
    key = _key_for_db(db_path)
    if not key:
        return None

    # quote() the wxid since it contains underscores but never quotes
    safe_wxid = wxid.replace("'", "''")
    cmd = (
        f"PRAGMA key = \"x'{key}'\";\n"
        "PRAGMA cipher_compatibility = 4;\n"
        "PRAGMA cipher_page_size = 4096;\n"
        ".headers off\n.mode csv\n"
        f"SELECT hex(image_buffer) FROM head_image WHERE username='{safe_wxid}' LIMIT 1;\n"
    )
    try:
        result = subprocess.run(
            [server.SQLCIPHER_PATH, db_path],
            input=cmd.encode(), capture_output=True, timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None

    out = result.stdout.decode("utf-8", errors="replace").strip()
    lines = [l.strip() for l in out.split("\n") if l.strip() and l.strip() != "ok"]
    if not lines:
        return None
    hex_str = lines[0].strip('"')
    if not hex_str or len(hex_str) % 2 != 0:
        return None
    try:
        data = bytes.fromhex(hex_str)
    except ValueError:
        return None
    if not data:
        return None

    os.makedirs(AVATAR_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return path


def avatar(args: dict) -> dict:
    wxid = (args.get("wxid") or "").strip()
    if not wxid:
        return {"error": "wxid required"}
    path = _ensure_avatar_extracted(wxid)
    if not path:
        return {"error": "no_avatar"}
    return {"path": path}


def read_chat(args: dict) -> dict:
    """Page of messages, newest-first slice via `before_ts`.

    UI calls with no `before_ts` to get the latest `limit` messages, then
    re-calls with `before_ts = oldest.ts` to prepend earlier history when
    the user scrolls up (infinite scroll, no time-range knob).
    """
    wxid = (args.get("wxid") or "").strip()
    limit = int(args.get("limit") or 50)
    before_ts = args.get("before_ts")
    try:
        before_ts = int(before_ts) if before_ts else 0
    except (ValueError, TypeError):
        before_ts = 0
    if not wxid:
        return {"error": "wxid required", "messages": []}

    table = f"Msg_{hashlib.md5(wxid.encode()).hexdigest()}"

    contacts = server._load_contacts()
    info = contacts.get(wxid, {})
    display = _display_name(wxid, info)

    where = f"create_time < {before_ts}" if before_ts > 0 else "1=1"

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
            f"FROM {table} WHERE {where} "
            f"ORDER BY create_time DESC LIMIT {limit + 1};",
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
    # Drop overflow used to detect "more pages exist" — we asked for limit+1.
    has_more = len(messages) > limit
    if has_more:
        messages = messages[-limit:]
    return {
        "wxid": wxid,
        "display": display,
        "messages": messages,
        "has_more": has_more,
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
    "list_sessions": list_sessions,
    "read_chat": read_chat,
    "resolve_image": resolve_image,
    "avatar": avatar,
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
