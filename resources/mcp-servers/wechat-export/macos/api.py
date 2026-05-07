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
import threading
from concurrent.futures import ThreadPoolExecutor

import server  # noqa: E402  (sibling module)
from message_decoder import (  # noqa: E402
    _maybe_decompress,
    decode_content,
    extract_self_wxid,
    get_my_sender_id_for_db,
)

CACHE_DIR = os.path.dirname(
    os.environ.get(
        "LUMOS_WECHAT_EXPORT_KEY_FILE",
        os.path.expanduser("~/.lumos/wechat-export/key.txt"),
    )
)
AVATAR_DIR = os.path.join(CACHE_DIR, "avatars")
KEYS_JSON_PATH = os.path.join(CACHE_DIR, "wechat_keys.json")
_SENDER_NAME2ID_CACHE: dict[str, dict[int, str]] = {}


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


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value or default)
    except (ValueError, TypeError):
        return default


def _message_db_diagnostics() -> dict:
    """Summarize message shard coverage without exposing chat content."""
    try:
        data_dir = server._find_data_dir()
    except Exception as err:  # noqa: BLE001 - diagnostics should not break reads
        return {
            "message_db_total": 0,
            "message_db_readable": 0,
            "message_db_unreadable": 0,
            "message_db_names": [],
            "readable_message_db_names": [],
            "skipped_message_db_names": [],
            "error": str(err),
        }

    paths = sorted(_glob.glob(os.path.join(data_dir, "message", "message_[0-9].db")))
    items: list[dict] = []
    for db_path in paths:
        name = os.path.basename(db_path)
        saved_key = _key_for_db(db_path)
        try:
            key = server._key_for_db(db_path)
            readable = server._test_key(key, db_path)
        except Exception:
            readable = False

        try:
            mtime = int(os.path.getmtime(db_path))
        except OSError:
            mtime = 0

        items.append({
            "name": name,
            "readable": readable,
            "has_saved_key": bool(saved_key),
            "mtime": mtime,
        })

    readable_items = [item for item in items if item["readable"]]
    unreadable_items = [item for item in items if not item["readable"]]
    return {
        "message_db_total": len(items),
        "message_db_readable": len(readable_items),
        "message_db_unreadable": len(unreadable_items),
        "message_db_names": [item["name"] for item in items],
        "readable_message_db_names": [item["name"] for item in readable_items],
        "skipped_message_db_names": [item["name"] for item in unreadable_items],
        "latest_message_db_mtime": max((item["mtime"] for item in items), default=0),
    }


def _session_snapshot(wxid: str) -> dict:
    """Read the left-list timestamp for this chat from session.db."""
    try:
        db_path = SESSION_DB_PATH()
        key = _key_for_db(db_path)
        if not key:
            return {}
        safe_wxid = wxid.replace("'", "''")
        rows = _query_with_key(
            db_path, key,
            "SELECT sort_timestamp, last_msg_type "
            f"FROM SessionTable WHERE username='{safe_wxid}' LIMIT 1;",
        )
    except Exception:
        return {}
    if not rows:
        return {}
    row = rows[0]
    return {
        "session_last_timestamp": _safe_int(row.get("sort_timestamp")),
        "session_last_msg_type": _safe_int(row.get("last_msg_type")),
    }


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

        ts = _safe_int(row.get("sort_timestamp"))
        msg_type = _safe_int(row.get("last_msg_type"))
        unread = _safe_int(row.get("unread_count"))

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


def _display_for_wxid(wxid: str, contacts: dict) -> str:
    info = contacts.get(wxid, {})
    display = _display_name(wxid, info)
    if not info and wxid.endswith("@chatroom"):
        display = f"群聊({wxid.split('@')[0]})"
    return display


def _message_table_entries() -> list[tuple[str, str, str]]:
    """Return all readable message tables as (db_path, table, wxid)."""
    name2id = server._get_name2id()
    entries: list[tuple[str, str, str]] = []
    for db_path in server._get_message_dbs():
        tables_raw = server._query_raw(
            db_path, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%';"
        )
        for table in [t.strip() for t in tables_raw if t.strip().startswith("Msg_")]:
            entries.append((db_path, table, name2id.get(table, table)))
    return entries


def _message_table_stats(db_path: str, table: str) -> dict:
    rows = server._query(
        db_path,
        f"SELECT COUNT(*) AS count, MAX(create_time) AS last_timestamp "
        f"FROM {table} WHERE message_content IS NOT NULL AND message_content != '';",
    )
    if not rows:
        return {"count": 0, "last_timestamp": 0}
    row = rows[0]
    try:
        count = int(row.get("count") or 0)
    except (ValueError, TypeError):
        count = 0
    try:
        last_timestamp = int(row.get("last_timestamp") or 0)
    except (ValueError, TypeError):
        last_timestamp = 0
    return {"count": count, "last_timestamp": last_timestamp}


def _sender_name2id_for_db(db_path: str) -> dict[int, str]:
    cached = _SENDER_NAME2ID_CACHE.get(db_path)
    if cached is not None:
        return cached
    mapping: dict[int, str] = {}
    try:
        for row in server._query(db_path, "SELECT rowid AS rowid, user_name FROM Name2Id;"):
            try:
                rowid = int(row.get("rowid") or 0)
            except (TypeError, ValueError):
                continue
            user_name = (row.get("user_name") or "").strip()
            if rowid > 0 and user_name:
                mapping[rowid] = user_name
    except Exception:  # noqa: BLE001
        mapping = {}
    _SENDER_NAME2ID_CACHE[db_path] = mapping
    return mapping


def _decode_snapshot_message(row: dict, db_path: str, wxid: str, display: str, is_group: bool, contacts: dict) -> dict | None:
    create_time = row.get("create_time") or "0"
    raw_type = row.get("local_type") or ""
    try:
        type_int = int(raw_type) if raw_type else 0
    except (ValueError, TypeError):
        type_int = 0
    low_type = type_int & 0xFFFF
    ts_int = int(create_time) if str(create_time).isdigit() else 0
    if ts_int <= 0:
        return None

    content_raw = row.get("message_content", "") or ""
    if low_type in (10000, 10002):
        rendered = "[系统消息]"
    else:
        rendered = decode_content(type_int, content_raw)
    content = (rendered or "").strip()
    if not content:
        return None

    sender_id = row.get("real_sender_id", "")
    is_me = server._is_my_message(sender_id, db_path)
    sender_wxid = ""
    try:
        sender_rowid = int(sender_id) if sender_id not in (None, "") else 0
    except (TypeError, ValueError):
        sender_rowid = 0
    if sender_rowid > 0:
        sender_wxid = _sender_name2id_for_db(db_path).get(sender_rowid, "")
    sender_display = "我" if is_me else (_display_for_wxid(sender_wxid, contacts) if sender_wxid else "")
    return {
        "wxid": wxid,
        "display": display,
        "is_group": is_group,
        "ts": ts_int,
        "sender": "me" if is_me else "them",
        "sender_wxid": sender_wxid or "",
        "sender_display": sender_display or "",
        "type": low_type,
        "content": content,
    }


def diagnostics(args: dict) -> dict:
    """Current WeChat message-db coverage for the repair UI."""
    diag = _message_db_diagnostics()
    diag["needs_reextract"] = diag.get("message_db_unreadable", 0) > 0
    return {"diagnostics": diag}


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
    diagnostics = _message_db_diagnostics()
    session = _session_snapshot(wxid)
    latest_message_ts = max((m["ts"] for m in messages), default=0)
    session_last_ts = _safe_int(session.get("session_last_timestamp"))
    diagnostics.update(session)
    diagnostics.update({
        "latest_message_timestamp": latest_message_ts,
        "is_detail_incomplete": diagnostics.get("message_db_unreadable", 0) > 0,
        "is_detail_stale": before_ts == 0 and session_last_ts > latest_message_ts,
    })
    return {
        "wxid": wxid,
        "display": display,
        "messages": messages,
        "has_more": has_more,
        "total": len(messages),
        "diagnostics": diagnostics,
    }


def analyze_snapshot(args: dict) -> dict:
    """Return a broad cross-session message snapshot for assistant analysis.

    This is intentionally a single Python op so the desktop UI doesn't spawn
    one Python process per chat while building the first analysis screen.
    It scans all readable message tables by default, then applies a safety
    cap to the returned messages until the product has a persistent index.
    """
    session_limit_raw = args.get("session_limit")
    session_limit = int(session_limit_raw) if session_limit_raw not in (None, "", 0) else 0
    if session_limit > 0:
        session_limit = min(max(session_limit, 1), 1000)
    per_session_limit = min(max(int(args.get("per_session_limit") or 0), 0), 2000)
    max_messages = min(max(int(args.get("max_messages") or 50000), 100), 200000)
    since_raw = args.get("since_timestamp")
    try:
        since_timestamp = int(since_raw) if since_raw not in (None, "") else 0
    except (TypeError, ValueError):
        since_timestamp = 0
    if since_timestamp < 0:
        since_timestamp = 0

    recent_sessions = list_sessions({"limit": max(session_limit, 1000)}).get("items") or []
    session_meta = {
        (session.get("wxid") or "").strip(): session
        for session in recent_sessions
        if (session.get("wxid") or "").strip()
    }
    contacts = server._load_contacts()
    table_entries = _message_table_entries()
    table_stats: list[dict] = []
    total_readable_messages = 0

    for db_path, table, wxid in table_entries:
        stats = _message_table_stats(db_path, table)
        count = int(stats.get("count") or 0)
        total_readable_messages += count
        if count <= 0:
            continue
        meta = session_meta.get(wxid) or {}
        display = meta.get("display") or _display_for_wxid(wxid, contacts)
        is_group = bool(meta.get("is_group")) or wxid.endswith("@chatroom")
        table_stats.append({
            "db_path": db_path,
            "table": table,
            "wxid": wxid,
            "display": display,
            "is_group": is_group,
            "count": count,
            "last_timestamp": int(stats.get("last_timestamp") or 0),
            "unread_count": int(meta.get("unread_count") or 0),
            "summary": meta.get("summary") or "",
        })

    table_stats.sort(key=lambda item: item["last_timestamp"], reverse=True)
    if session_limit > 0:
        table_stats = table_stats[:session_limit]

    sessions = [{
        "wxid": item["wxid"],
        "display": item["display"],
        "summary": item["summary"],
        "last_timestamp": item["last_timestamp"],
        "unread_count": item["unread_count"],
        "is_group": item["is_group"],
        "message_count": item["count"],
    } for item in table_stats]

    selected_total = sum(int(item["count"] or 0) for item in table_stats)
    messages_remaining = max_messages
    messages: list[dict] = []

    for item in table_stats:
        if messages_remaining <= 0:
            break
        count = int(item["count"] or 0)
        if count <= 0:
            continue
        # Skip sessions whose latest message is older than the requested
        # window — they cannot contribute any in-window rows.
        if since_timestamp > 0 and int(item.get("last_timestamp") or 0) < since_timestamp:
            continue
        limit = min(messages_remaining, per_session_limit or count)
        where_clause = "WHERE message_content IS NOT NULL AND message_content != ''"
        if since_timestamp > 0:
            where_clause += f" AND create_time >= {since_timestamp}"
        rows = server._query(
            item["db_path"],
            f"SELECT local_id, create_time, local_type, real_sender_id, message_content "
            f"FROM {item['table']} "
            f"{where_clause} "
            f"ORDER BY create_time DESC LIMIT {limit};",
        )
        messages_remaining -= len(rows)
        for row in rows:
            message = _decode_snapshot_message(
                row,
                item["db_path"],
                item["wxid"],
                item["display"],
                bool(item["is_group"]),
                contacts,
            )
            if message is None:
                continue
            messages.append(message)

    messages.sort(key=lambda m: m.get("ts") or 0, reverse=True)
    messages_truncated = selected_total > len(messages)
    return {
        "sessions": sessions,
        "messages": messages,
        "sessions_scanned": len(sessions),
        "messages_scanned": len(messages),
        "total_readable_messages": total_readable_messages,
        "selected_readable_messages": selected_total,
        "messages_truncated": messages_truncated,
        "scan_scope": "all_readable_wechat_messages" if session_limit <= 0 else "limited_recent_sessions",
        "safety_limit": max_messages,
    }


_EMIT_LOCK = threading.Lock()


def _emit_jsonl(obj: dict) -> None:
    """Stream a JSON record to stdout, one per line, flushing immediately.

    Lock-protected so concurrent DB workers (ThreadPoolExecutor) can't
    interleave halves of two records.
    """
    line = json.dumps(obj, ensure_ascii=False) + "\n"
    with _EMIT_LOCK:
        sys.stdout.write(line)
        sys.stdout.flush()


def _stream_db_messages(
    db_path: str,
    tables: list[str],
    since_timestamp: int,
    my_sender_id: int | None,
    sender_rowid_map: dict[int, str],
    name2id: dict[str, str],
    contacts: dict,
    session_meta: dict[str, dict],
) -> int:
    """Pull all in-window messages from one db in a SINGLE sqlcipher process.

    The PBKDF2 key-derivation cost dominates per-process startup, so we
    batch every Msg_ table SELECT into one stdin payload. Output is parsed
    incrementally via csv.reader streaming over the subprocess stdout.
    Returns the number of messages emitted.
    """
    key = server._key_for_db(db_path)
    if not key:
        return 0
    sql_lines = [
        f'PRAGMA key = "x\'{key}\'";',
        "PRAGMA cipher_compatibility = 4;",
        "PRAGMA cipher_page_size = 4096;",
        ".headers off",
        ".mode csv",
    ]
    where_extra = (
        f" AND create_time >= {int(since_timestamp)}" if since_timestamp > 0 else ""
    )
    for tbl in tables:
        sql_lines.append(
            f"SELECT '{tbl}', local_id, create_time, local_type, real_sender_id, message_content "
            f"FROM {tbl} "
            f"WHERE message_content IS NOT NULL AND message_content != ''{where_extra} "
            f"ORDER BY create_time DESC;"
        )
    sql_input = "\n".join(sql_lines) + "\n"

    proc = subprocess.Popen(
        [server.SQLCIPHER_PATH, db_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdin and proc.stdout and proc.stderr

    proc.stdin.write(sql_input.encode("utf-8"))
    proc.stdin.close()

    text_stream = io.TextIOWrapper(
        proc.stdout, encoding="utf-8", errors="surrogateescape", newline=""
    )
    reader = csv.reader(text_stream)
    emitted = 0

    try:
        for row in reader:
            if not row:
                continue
            if len(row) == 1 and row[0].strip() == "ok":
                continue
            if len(row) < 6:
                continue
            tbl_name = row[0]
            wxid = name2id.get(tbl_name, tbl_name)
            try:
                create_time = int(row[2])
            except (TypeError, ValueError):
                continue
            if create_time <= 0:
                continue
            try:
                local_type = int(row[3]) if row[3] else 0
            except (TypeError, ValueError):
                local_type = 0
            try:
                sender_rowid = int(row[4]) if row[4] else None
            except (TypeError, ValueError):
                sender_rowid = None

            low_type = local_type & 0xFFFF
            # Decode strategy:
            #   - text (1)        → decode (fast path for plain UTF-8)
            #   - system (10000+) → fixed placeholder
            #   - media (others)  → SKIP zstd/XML decode entirely; we only
            #     need the count + type for overview metrics. The decode
            #     tax (~1ms each × 200k rows) was the user-visible bottleneck.
            if low_type == 1:
                decoded = decode_content(local_type, row[5])
                content = (decoded or "").strip()
                if not content:
                    continue  # broken text row — drop
            elif low_type in (10000, 10002):
                content = "[系统消息]"
            else:
                content = ""

            is_me = my_sender_id is not None and sender_rowid == my_sender_id
            sender_wxid = sender_rowid_map.get(sender_rowid) if sender_rowid is not None else ""
            sender_display = "我" if is_me else (_display_for_wxid(sender_wxid, contacts) if sender_wxid else "")
            # Per-msg JSON keeps only fields the mirror needs. wxid maps to
            # display/is_group via the meta record emitted earlier.
            _emit_jsonl({
                "type": "msg",
                "wxid": wxid,
                "ts": create_time,
                "sender": "me" if is_me else "them",
                "sender_wxid": sender_wxid or "",
                "sender_display": sender_display or "",
                "msg_type": low_type,
                "content": content,
            })
            emitted += 1
    finally:
        try:
            proc.wait(timeout=600)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        if proc.returncode and proc.returncode != 0:
            err_text = ""
            try:
                err_text = proc.stderr.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            sys.stderr.write(
                f"[sync_stream] sqlcipher exit {proc.returncode} on {os.path.basename(db_path)}: {err_text.strip()[:500]}\n"
            )
    return emitted


def sync_stream(args: dict) -> None:
    """Streaming op: emit JSONL records straight to stdout.

    Wire (line-by-line):
        {"type":"meta","sessions":[…]}
        {"type":"db_start","db":"message_0.db","tables":120}
        {"type":"msg","wxid":…,"ts":…,…}     × N
        {"type":"db_done","db":"message_0.db","messages":15234}
        …
        {"type":"done","cursor":<max ts seen>,"messages":<grand total>}

    Args:
        since_timestamp: unix seconds — only messages with create_time >= since.
                         0 (default) means full historical sync.
    """
    since_raw = args.get("since_timestamp")
    try:
        since_timestamp = int(since_raw) if since_raw not in (None, "") else 0
    except (TypeError, ValueError):
        since_timestamp = 0
    if since_timestamp < 0:
        since_timestamp = 0

    t0 = time.monotonic()
    sys.stderr.write(f"[sync_stream] start since={since_timestamp}\n")
    sys.stderr.flush()

    # Pull session metadata for as many chats as the user has.
    # The earlier 1000 cap silently dropped messages from long-tail chats
    # because compute filtered out wxids without a session entry.
    sessions_data = list_sessions({"limit": 10000}).get("items") or []
    contacts = server._load_contacts()
    name2id = server._get_name2id()
    session_meta = {(s.get("wxid") or "").strip(): s for s in sessions_data if s.get("wxid")}

    _emit_jsonl({"type": "meta", "sessions": sessions_data})
    sys.stderr.write(
        f"[sync_stream] meta loaded ({len(sessions_data)} sessions) in {time.monotonic()-t0:.2f}s\n"
    )
    sys.stderr.flush()

    db_paths = server._get_message_dbs()
    max_ts_seen = since_timestamp
    for s in sessions_data:
        ts = int(s.get("last_timestamp") or 0)
        if ts > max_ts_seen:
            max_ts_seen = ts

    def process_db(db_path: str) -> int:
        db_basename = os.path.basename(db_path)
        self_wxid = extract_self_wxid(db_path)
        my_sender_id = None
        if self_wxid:
            try:
                my_sender_id = get_my_sender_id_for_db(
                    db_path, server.SQLCIPHER_PATH, server._key_for_db(db_path), self_wxid
                )
            except Exception as err:  # noqa: BLE001
                sys.stderr.write(f"[sync_stream] {db_basename} my_sender lookup failed: {err}\n")

        sender_rowid_map: dict[int, str] = {}
        try:
            for row in server._query(db_path, "SELECT rowid AS rowid, user_name FROM Name2Id;"):
                try:
                    rowid = int(row.get("rowid") or 0)
                except (TypeError, ValueError):
                    continue
                user_name = (row.get("user_name") or "").strip()
                if rowid > 0 and user_name:
                    sender_rowid_map[rowid] = user_name
        except Exception as err:  # noqa: BLE001
            sys.stderr.write(f"[sync_stream] {db_basename} sender lookup failed: {err}\n")

        try:
            tables_raw = server._query_raw(
                db_path,
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%';",
            )
        except Exception as err:  # noqa: BLE001
            sys.stderr.write(f"[sync_stream] {db_basename} table list failed: {err}\n")
            return 0
        tables = [t.strip() for t in tables_raw if t.strip().startswith("Msg_")]

        _emit_jsonl({"type": "db_start", "db": db_basename, "tables": len(tables)})
        if not tables:
            _emit_jsonl({"type": "db_done", "db": db_basename, "messages": 0})
            return 0

        emitted_for_db = _stream_db_messages(
            db_path,
            tables,
            since_timestamp,
            my_sender_id,
            sender_rowid_map,
            name2id,
            contacts,
            session_meta,
        )
        _emit_jsonl({"type": "db_done", "db": db_basename, "messages": emitted_for_db})
        sys.stderr.write(
            f"[sync_stream] {db_basename} → {emitted_for_db} msgs at {time.monotonic()-t0:.1f}s\n"
        )
        sys.stderr.flush()
        return emitted_for_db

    # Process message DBs in parallel — each gets its own sqlcipher process,
    # so they're independent at the OS level. Python threads only handle CSV
    # parse + emit, which the GIL serialises but doesn't actually block on
    # since the heavy work is in the subprocess.
    grand_total = 0
    if db_paths:
        worker_count = min(len(db_paths), 4)
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            for emitted in pool.map(process_db, db_paths):
                grand_total += emitted

    _emit_jsonl({"type": "done", "cursor": max_ts_seen, "messages": grand_total})
    sys.stderr.write(
        f"[sync_stream] done total={grand_total} cursor={max_ts_seen} in {time.monotonic()-t0:.1f}s\n"
    )
    sys.stderr.flush()


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
    "analyze_snapshot": analyze_snapshot,
    "diagnostics": diagnostics,
    "resolve_image": resolve_image,
    "avatar": avatar,
    "sync_stream": sync_stream,
}

# Streaming ops write JSONL straight to stdout themselves; main() must not
# wrap their return value in a JSON envelope.
STREAMING_OPS = {"sync_stream"}


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
        if op in STREAMING_OPS:
            _emit_jsonl({"type": "error", "message": f"{type(err).__name__}: {err}"})
        sys.stderr.write(f"{type(err).__name__}: {err}\n")
        return 1

    if op in STREAMING_OPS:
        return 0
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
