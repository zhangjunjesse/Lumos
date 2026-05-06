"""JSON-in/JSON-out API for Windows WeChat databases.

Windows WeChat stores one account under:
  WeChat Files/<wxid>/MSG/MicroMsg.db
  WeChat Files/<wxid>/MSG/MSG*.db
or newer data roots such as:
  xwechat_files/<wxid>/db_storage/contact/contact.db
  xwechat_files/<wxid>/db_storage/message/message_*.db

The files are SQLCipher-style encrypted with one account key. Lumos extracts
that key once, decrypts read-only copies into ~/.lumos/wechat-export, and opens
the copies with sqlite3 for UI and MCP reads.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
from typing import Any

SQLITE_FILE_HEADER = b"SQLite format 3\x00"
PAGE_SIZE = 4096
KEY_SIZE = 32
MESSAGE_DB_RE = re.compile(r"^(?:MSG|message|media|biz_message)(?:_?\d+)?\.db$", re.I)

CACHE_DIR = os.path.dirname(
    os.environ.get(
        "LUMOS_WECHAT_EXPORT_KEY_FILE",
        os.path.expanduser("~/.lumos/wechat-export/key.txt"),
    )
)
WINDOWS_ACCOUNTS_FILE = os.environ.get(
    "LUMOS_WECHAT_EXPORT_WINDOWS_ACCOUNTS_FILE",
    os.path.join(CACHE_DIR, "windows_accounts.json"),
)
DECRYPT_DIR = os.environ.get(
    "LUMOS_WECHAT_EXPORT_WINDOWS_DECRYPT_DIR",
    os.path.join(CACHE_DIR, "windows-decrypted"),
)
AVATAR_DIR = os.path.join(CACHE_DIR, "avatars")

MSG_TYPE_PLACEHOLDERS = {
    3: "[图片]",
    34: "[语音]",
    43: "[视频]",
    47: "[表情]",
    49: "[链接/卡片]",
    10000: "[系统]",
    10002: "[系统]",
}


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def _norm_ts(value: object) -> int:
    ts = _safe_int(value)
    return ts // 1000 if ts > 10_000_000_000 else ts


def _raw_ts_bounds(ts: int) -> tuple[int, int]:
    """Return (millisecond-bound, second-bound) for mixed WeChat schemas."""
    return ts * 1000, ts


def _load_accounts() -> list[dict]:
    if not os.path.exists(WINDOWS_ACCOUNTS_FILE):
        return []
    try:
        data = json.load(open(WINDOWS_ACCOUNTS_FILE, "r", encoding="utf-8"))
        if not isinstance(data, list):
            return []
        accounts = []
        for item in data:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            wx_dir = str(item.get("wx_dir") or "").strip()
            wxid = str(item.get("wxid") or os.path.basename(wx_dir)).strip()
            if re.fullmatch(r"[0-9a-fA-F]{64}", key) and wx_dir and os.path.isdir(wx_dir):
                accounts.append({**item, "key": key, "wx_dir": wx_dir, "wxid": wxid})
        return accounts
    except (OSError, json.JSONDecodeError):
        return []


def _account() -> dict:
    accounts = _load_accounts()
    if not accounts:
        raise FileNotFoundError("未找到 Windows 微信密钥。请先在 Lumos 里点击“开始”提取密钥。")
    accounts.sort(key=lambda item: _safe_int(item.get("extracted_at")), reverse=True)
    return accounts[0]


def _msg_dir() -> str:
    account = _account()
    msg_dir = str(account.get("msg_dir") or "").strip()
    if msg_dir and os.path.isdir(msg_dir):
        return msg_dir
    for name in ("MSG", "Msg"):
        candidate = os.path.join(account["wx_dir"], name)
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(account["wx_dir"], "MSG")


def _encrypted_micro_db() -> str:
    micro = os.path.join(_msg_dir(), "MicroMsg.db")
    if os.path.exists(micro):
        return micro
    contact = os.path.join(_msg_dir(), "contact", "contact.db")
    return contact if os.path.exists(contact) else micro


def _encrypted_message_dbs() -> list[str]:
    account = _account()
    msg_dir = str(account.get("message_db_dir") or "").strip() or _msg_dir()
    if not os.path.isdir(msg_dir):
        multi_dir = os.path.join(_msg_dir(), "Multi")
        if os.path.isdir(multi_dir):
            msg_dir = multi_dir
    if not os.path.isdir(msg_dir):
        return []
    dbs = []
    for name in os.listdir(msg_dir):
        if MESSAGE_DB_RE.fullmatch(name):
            dbs.append(os.path.join(msg_dir, name))
    return sorted(dbs)


def _verify_key(key_bytes: bytes, db_path: str) -> bool:
    try:
        with open(db_path, "rb") as fh:
            data = fh.read(5000)
    except OSError:
        return False
    if len(key_bytes) != 32 or len(data) < PAGE_SIZE:
        return False
    salt = data[:16]
    first = data[16:PAGE_SIZE]
    decrypt_key = hashlib.pbkdf2_hmac("sha1", key_bytes, salt, 64000, KEY_SIZE)
    mac_salt = bytes((b ^ 58) for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha1", decrypt_key, mac_salt, 2, KEY_SIZE)
    digest = hmac.new(mac_key, first[:-32], hashlib.sha1)
    digest.update(b"\x01\x00\x00\x00")
    return hmac.compare_digest(digest.digest(), first[-32:-12])


def _decrypt_db(key_hex: str, db_path: str, out_path: str) -> str:
    try:
        from Cryptodome.Cipher import AES
    except Exception as err:  # noqa: BLE001
        raise RuntimeError("Windows 微信读取缺少 pycryptodomex。请在微信页面重新点击“启用”。") from err

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path) and os.path.getmtime(out_path) >= os.path.getmtime(db_path):
        return out_path

    key = bytes.fromhex(key_hex)
    if not _verify_key(key, db_path):
        raise RuntimeError(f"数据库密钥不匹配: {os.path.basename(db_path)}")

    with open(db_path, "rb") as fh:
        raw = fh.read()
    salt = raw[:16]
    decrypt_key = hashlib.pbkdf2_hmac("sha1", key, salt, 64000, KEY_SIZE)
    fd, tmp_path = tempfile.mkstemp(prefix="lumos-wechat-", suffix=".db", dir=os.path.dirname(out_path))
    os.close(fd)
    try:
        with open(tmp_path, "wb") as out:
            out.write(SQLITE_FILE_HEADER)
            for offset in range(0, len(raw), PAGE_SIZE):
                page = raw[offset: offset + PAGE_SIZE] if offset > 0 else raw[16: offset + PAGE_SIZE]
                if len(page) < 64:
                    continue
                out.write(AES.new(decrypt_key, AES.MODE_CBC, page[-48:-32]).decrypt(page[:-48]))
                out.write(page[-48:])
        os.replace(tmp_path, out_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    return out_path


def _cache_path(db_path: str) -> str:
    account = _account()
    rel = os.path.relpath(db_path, account["wx_dir"])
    safe_rel = rel.replace(":", "").replace("\\", "/")
    return os.path.join(DECRYPT_DIR, account["wxid"], safe_rel)


def _decrypted(db_path: str) -> str:
    return _decrypt_db(_account()["key"], db_path, _cache_path(db_path))


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(_decrypted(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table,),
    ).fetchone()
    return row is not None


def _rows(db_path: str, sql: str, params: tuple = ()) -> list[dict]:
    with _connect(db_path) as conn:
        cur = conn.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


_contacts_cache: dict[str, dict] | None = None


def _load_contacts() -> dict[str, dict]:
    global _contacts_cache
    if _contacts_cache is not None:
        return _contacts_cache
    contacts: dict[str, dict] = {}
    db_path = _encrypted_micro_db()
    try:
        with _connect(db_path) as conn:
            if not _table_exists(conn, "Contact"):
                _contacts_cache = {}
                return {}
            for row in conn.execute("SELECT UserName, NickName, Remark FROM Contact WHERE UserName!=''"):
                wxid = (row["UserName"] or "").strip()
                if not wxid:
                    continue
                contacts[wxid] = {
                    "nickname": (row["NickName"] or "").strip(),
                    "remark": (row["Remark"] or "").strip(),
                }
    except Exception:
        contacts = {}
    _contacts_cache = contacts
    return contacts


def _display_name(wxid: str, info: dict) -> str:
    if info.get("remark"):
        return info["remark"]
    if info.get("nickname"):
        return info["nickname"]
    if wxid.endswith("@chatroom"):
        return f"群聊({wxid.split('@')[0]})"
    return wxid


def _summary(raw: object, msg_type: int) -> str:
    text = str(raw or "").strip()
    if msg_type == 1:
        return text[:60] + ("…" if len(text) > 60 else "")
    return MSG_TYPE_PLACEHOLDERS.get(msg_type, text[:60] if text else "[不支持的消息]")


def list_contacts(args: dict) -> dict:
    query = str(args.get("query") or "").lower().strip()
    limit = int(args.get("limit") or 200)
    contacts = _load_contacts()
    items = []
    for wxid, info in contacts.items():
        display = _display_name(wxid, info)
        haystack = f"{wxid} {display} {info.get('nickname', '')} {info.get('remark', '')}".lower()
        if query and query not in haystack:
            continue
        items.append({
            "wxid": wxid,
            "display": display,
            "nickname": info.get("nickname", ""),
            "remark": info.get("remark", ""),
            "has_remark": bool(info.get("remark")),
        })
    items.sort(key=lambda item: (not item["has_remark"], item["display"].lower()))
    return {"items": items[:limit], "total": len(items)}


def list_sessions(args: dict) -> dict:
    limit = int(args.get("limit") or 100)
    contacts = _load_contacts()
    db_path = _encrypted_micro_db()
    items = []
    with _connect(db_path) as conn:
        if not _table_exists(conn, "Session"):
            return {"items": [], "total": 0, "error": "session_table_unavailable"}
        has_contact_table = _table_exists(conn, "Contact")
        if has_contact_table:
            sql = (
                "SELECT S.strUsrName, S.strContent, S.nTime, S.nMsgType, S.nUnReadCount, "
                "C.NickName, C.Remark "
                "FROM (SELECT strUsrName, MAX(nTime) AS MaxnTime FROM Session GROUP BY strUsrName) AS SubQuery "
                "JOIN Session S ON S.strUsrName = SubQuery.strUsrName AND S.nTime = SubQuery.MaxnTime "
                "LEFT JOIN Contact C ON C.UserName = S.strUsrName "
                "WHERE S.strUsrName!='@publicUser' "
                "ORDER BY S.nTime DESC LIMIT ?"
            )
        else:
            sql = (
                "SELECT S.strUsrName, S.strContent, S.nTime, S.nMsgType, S.nUnReadCount, "
                "'' AS NickName, '' AS Remark "
                "FROM (SELECT strUsrName, MAX(nTime) AS MaxnTime FROM Session GROUP BY strUsrName) AS SubQuery "
                "JOIN Session S ON S.strUsrName = SubQuery.strUsrName AND S.nTime = SubQuery.MaxnTime "
                "WHERE S.strUsrName!='@publicUser' "
                "ORDER BY S.nTime DESC LIMIT ?"
            )
        rows = conn.execute(sql, (limit,)).fetchall()
        for row in rows:
            wxid = (row["strUsrName"] or "").strip()
            if not wxid:
                continue
            info = contacts.get(wxid, {
                "nickname": (row["NickName"] or "").strip() if "NickName" in row.keys() else "",
                "remark": (row["Remark"] or "").strip() if "Remark" in row.keys() else "",
            })
            msg_type = _safe_int(row["nMsgType"])
            items.append({
                "wxid": wxid,
                "display": _display_name(wxid, info),
                "nickname": info.get("nickname", ""),
                "remark": info.get("remark", ""),
                "has_remark": bool(info.get("remark")),
                "summary": _summary(row["strContent"], msg_type),
                "last_timestamp": _norm_ts(row["nTime"]),
                "last_msg_type": msg_type,
                "unread_count": _safe_int(row["nUnReadCount"]),
                "is_group": wxid.endswith("@chatroom"),
            })
    return {"items": items, "total": len(items)}


def _message_db_status() -> list[dict]:
    items = []
    for db_path in _encrypted_message_dbs():
        readable = False
        error = ""
        try:
            with _connect(db_path) as conn:
                readable = _table_exists(conn, "MSG")
        except Exception as err:  # noqa: BLE001
            error = str(err)
        try:
            mtime = int(os.path.getmtime(db_path))
        except OSError:
            mtime = 0
        items.append({"name": os.path.basename(db_path), "path": db_path, "readable": readable, "mtime": mtime, "error": error})
    return items


def _message_db_diagnostics() -> dict:
    items = _message_db_status()
    readable = [item for item in items if item["readable"]]
    skipped = [item for item in items if not item["readable"]]
    return {
        "message_db_total": len(items),
        "message_db_readable": len(readable),
        "message_db_unreadable": len(skipped),
        "message_db_names": [item["name"] for item in items],
        "readable_message_db_names": [item["name"] for item in readable],
        "skipped_message_db_names": [item["name"] for item in skipped],
        "latest_message_db_mtime": max((item["mtime"] for item in items), default=0),
    }


def diagnostics(args: dict) -> dict:
    diag = _message_db_diagnostics()
    diag["needs_reextract"] = diag.get("message_db_unreadable", 0) > 0
    return {"diagnostics": diag}


def _session_snapshot(wxid: str) -> dict:
    try:
        rows = _rows(
            _encrypted_micro_db(),
            "SELECT nTime, nMsgType FROM Session WHERE strUsrName=? ORDER BY nTime DESC LIMIT 1",
            (wxid,),
        )
    except Exception:
        return {}
    if not rows:
        return {}
    return {
        "session_last_timestamp": _norm_ts(rows[0].get("nTime")),
        "session_last_msg_type": _safe_int(rows[0].get("nMsgType")),
    }


def _render_message(msg_type: int, sub_type: int, content: object) -> str:
    text = str(content or "").replace("\x00", "").strip()
    if msg_type == 1:
        return text
    if msg_type in (10000, 10002):
        return text or "[系统消息]"
    if msg_type == 49 and text:
        return text
    return MSG_TYPE_PLACEHOLDERS.get(msg_type, text or "[暂不支持的消息]")


def read_chat(args: dict) -> dict:
    wxid = str(args.get("wxid") or "").strip()
    limit = int(args.get("limit") or 50)
    before_ts = _safe_int(args.get("before_ts"))
    if not wxid:
        return {"error": "wxid required", "messages": []}

    contacts = _load_contacts()
    info = contacts.get(wxid, {})
    messages = []
    for db_path in _encrypted_message_dbs():
        try:
            with _connect(db_path) as conn:
                if not _table_exists(conn, "MSG"):
                    continue
                where = "StrTalker=?"
                params: list[Any] = [wxid]
                if before_ts > 0:
                    before_ms, before_sec = _raw_ts_bounds(before_ts)
                    where += " AND CASE WHEN CreateTime>10000000000 THEN CreateTime<? ELSE CreateTime<? END"
                    params.extend([before_ms, before_sec])
                params.append(limit + 1)
                rows = conn.execute(
                    "SELECT localId, CreateTime, Type, SubType, IsSender, StrContent "
                    f"FROM MSG WHERE {where} ORDER BY CreateTime DESC LIMIT ?",
                    tuple(params),
                ).fetchall()
        except Exception:
            continue
        for row in rows:
            msg_type = _safe_int(row["Type"])
            sub_type = _safe_int(row["SubType"])
            ts = _norm_ts(row["CreateTime"])
            messages.append({
                "ts": ts,
                "sender": "me" if _safe_int(row["IsSender"]) == 1 else "them",
                "type": msg_type,
                "type_label": MSG_TYPE_PLACEHOLDERS.get(msg_type, ""),
                "content": _render_message(msg_type, sub_type, row["StrContent"]),
                "has_image": False,
            })

    messages.sort(key=lambda item: item["ts"])
    has_more = len(messages) > limit
    if has_more:
        messages = messages[-limit:]

    diag = _message_db_diagnostics()
    session = _session_snapshot(wxid)
    session_last_ts = _safe_int(session.get("session_last_timestamp"))
    latest_ts = max((item["ts"] for item in messages), default=0)
    diag.update(session)
    diag.update({
        "latest_message_timestamp": latest_ts,
        "is_detail_incomplete": diag.get("message_db_unreadable", 0) > 0,
        "is_detail_stale": before_ts == 0 and session_last_ts > latest_ts,
    })
    return {
        "wxid": wxid,
        "display": _display_name(wxid, info),
        "messages": messages,
        "has_more": has_more,
        "total": len(messages),
        "diagnostics": diag,
    }


def search_messages(keyword: str, days: int = 30, limit: int = 50) -> list[dict]:
    since = int(time.time()) - days * 86400
    since_ms, since_sec = _raw_ts_bounds(since)
    result = []
    like = f"%{keyword}%"
    for db_path in _encrypted_message_dbs():
        try:
            with _connect(db_path) as conn:
                if not _table_exists(conn, "MSG"):
                    continue
                rows = conn.execute(
                    "SELECT CreateTime, Type, SubType, IsSender, StrContent, StrTalker "
                    "FROM MSG WHERE CASE WHEN CreateTime>10000000000 THEN CreateTime>? ELSE CreateTime>? END "
                    "AND StrContent LIKE ? "
                    "ORDER BY CreateTime DESC LIMIT ?",
                    (since_ms, since_sec, like, limit),
                ).fetchall()
        except Exception:
            continue
        for row in rows:
            msg_type = _safe_int(row["Type"])
            result.append({
                "ts": _norm_ts(row["CreateTime"]),
                "wxid": row["StrTalker"],
                "sender": "me" if _safe_int(row["IsSender"]) == 1 else "them",
                "content": _render_message(msg_type, _safe_int(row["SubType"]), row["StrContent"]),
            })
    result.sort(key=lambda item: item["ts"], reverse=True)
    return result[:limit]


def avatar(args: dict) -> dict:
    return {"error": "no_avatar"}


def resolve_image(args: dict) -> dict:
    return {"error": "not_supported"}


OPS = {
    "list_contacts": list_contacts,
    "list_sessions": list_sessions,
    "read_chat": read_chat,
    "diagnostics": diagnostics,
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
        sys.stderr.write(f"unknown op: {op!r}\n")
        return 1
    try:
        sys.stdout.write(json.dumps(OPS[op](payload.get("args") or {}), ensure_ascii=False))
        return 0
    except Exception as err:  # noqa: BLE001
        sys.stderr.write(f"{type(err).__name__}: {err}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
