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
import struct
import sys
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any

SQLITE_FILE_HEADER = b"SQLite format 3\x00"
PAGE_SIZE = 4096
KEY_SIZE = 32
SALT_SIZE = 16
V3_RESERVED = 48
V4_RESERVED = 80
MESSAGE_DB_RE = re.compile(r"^(?:MSG|message|media|biz_message)(?:_?\d+)?\.db$", re.I)


def configure_stdio() -> None:
    """Windows defaults to GBK in many packaged runs; WeChat data may contain emoji."""
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if not stream:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass


configure_stdio()


def safe_stream_write(stream, text: str) -> None:
    try:
        stream.write(text)
        stream.flush()
    except UnicodeEncodeError:
        buffer = getattr(stream, "buffer", None)
        if buffer:
            buffer.write(text.encode("utf-8", errors="backslashreplace"))
            buffer.flush()
        else:
            stream.write(text.encode("ascii", errors="backslashreplace").decode("ascii"))
            stream.flush()


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
            keys_raw = item.get("keys")
            keys = {
                str(salt).lower(): str(value).lower()
                for salt, value in (keys_raw.items() if isinstance(keys_raw, dict) else [])
                if re.fullmatch(r"[0-9a-fA-F]{32}", str(salt))
                and re.fullmatch(r"[0-9a-fA-F]{64}", str(value))
            }
            wx_dir = str(item.get("wx_dir") or "").strip()
            wxid = str(item.get("wxid") or os.path.basename(wx_dir)).strip()
            if (re.fullmatch(r"[0-9a-fA-F]{64}", key) or keys) and wx_dir and os.path.isdir(wx_dir):
                accounts.append({**item, "key": key, "keys": keys, "wx_dir": wx_dir, "wxid": wxid})
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


def _is_db_storage_layout() -> bool:
    return os.path.basename(_msg_dir()).lower() == "db_storage"


def _encrypted_contact_db() -> str:
    if _is_db_storage_layout():
        return os.path.join(_msg_dir(), "contact", "contact.db")
    return _encrypted_micro_db()


def _encrypted_session_db() -> str:
    if _is_db_storage_layout():
        return os.path.join(_msg_dir(), "session", "session.db")
    return _encrypted_micro_db()


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


def _db_salt(db_path: str) -> str | None:
    try:
        with open(db_path, "rb") as fh:
            data = fh.read(SALT_SIZE)
    except OSError:
        return None
    return data.hex() if len(data) == SALT_SIZE else None


def _key_for_db(db_path: str) -> str:
    account = _account()
    salt = _db_salt(db_path)
    keys = account.get("keys")
    if salt and isinstance(keys, dict):
        key = str(keys.get(salt) or "").strip()
        if re.fullmatch(r"[0-9a-fA-F]{64}", key):
            return key
    key = str(account.get("key") or "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{64}", key):
        return key
    raise RuntimeError(f"未找到可用于 {os.path.basename(db_path)} 的数据库密钥")


def _verify_key_v3(key_bytes: bytes, data: bytes) -> bool:
    if len(key_bytes) != KEY_SIZE or len(data) < PAGE_SIZE:
        return False
    salt = data[:16]
    first = data[16:PAGE_SIZE]
    decrypt_key = hashlib.pbkdf2_hmac("sha1", key_bytes, salt, 64000, KEY_SIZE)
    mac_salt = bytes((b ^ 58) for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha1", decrypt_key, mac_salt, 2, KEY_SIZE)
    digest = hmac.new(mac_key, first[:-32], hashlib.sha1)
    digest.update(b"\x01\x00\x00\x00")
    return hmac.compare_digest(digest.digest(), first[-32:-12])


def _verify_key_v4(key_bytes: bytes, data: bytes) -> bool:
    if len(key_bytes) != KEY_SIZE or len(data) < PAGE_SIZE:
        return False
    salt = data[:SALT_SIZE]
    first = data[SALT_SIZE:PAGE_SIZE]
    mac_salt = bytes((b ^ 0x3A) for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", key_bytes, mac_salt, 2, KEY_SIZE)
    hmac_data = first[:PAGE_SIZE - V4_RESERVED]
    stored_hmac = first[PAGE_SIZE - V4_RESERVED:PAGE_SIZE - SALT_SIZE]
    if len(stored_hmac) != 64:
        return False
    digest = hmac.new(mac_key, hmac_data, hashlib.sha512)
    digest.update(struct.pack("<I", 1))
    return hmac.compare_digest(digest.digest(), stored_hmac)


def _cipher_mode(key_bytes: bytes, db_path: str) -> str:
    try:
        with open(db_path, "rb") as fh:
            data = fh.read(PAGE_SIZE)
    except OSError:
        data = b""
    if _verify_key_v4(key_bytes, data):
        return "v4"
    if _verify_key_v3(key_bytes, data):
        return "v3"
    raise RuntimeError(f"数据库密钥不匹配: {os.path.basename(db_path)}")


def _decrypt_db(key_hex: str, db_path: str, out_path: str) -> str:
    try:
        from Cryptodome.Cipher import AES
    except Exception as err:  # noqa: BLE001
        raise RuntimeError("Windows 微信读取缺少 pycryptodomex。请在微信页面重新点击“启用”。") from err

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path) and os.path.getmtime(out_path) >= os.path.getmtime(db_path):
        return out_path

    key = bytes.fromhex(key_hex)
    with open(db_path, "rb") as fh:
        raw = fh.read()
    mode = _cipher_mode(key, db_path)
    salt = raw[:SALT_SIZE]
    decrypt_key = hashlib.pbkdf2_hmac("sha1", key, salt, 64000, KEY_SIZE) if mode == "v3" else key
    reserved = V3_RESERVED if mode == "v3" else V4_RESERVED
    fd, tmp_path = tempfile.mkstemp(prefix="lumos-wechat-", suffix=".db", dir=os.path.dirname(out_path))
    os.close(fd)
    try:
        with open(tmp_path, "wb") as out:
            out.write(SQLITE_FILE_HEADER)
            for offset in range(0, len(raw), PAGE_SIZE):
                page = raw[offset: offset + PAGE_SIZE]
                if offset == 0:
                    page = page[SALT_SIZE:]
                if len(page) < reserved + 16:
                    continue
                out.write(AES.new(decrypt_key, AES.MODE_CBC, page[-reserved:-reserved + 16]).decrypt(page[:-reserved]))
                out.write(page[-reserved:])
        try:
            os.replace(tmp_path, out_path)
        except OSError:
            # Windows refuses to replace a SQLite file while another Lumos
            # reader still has it open. If another process already produced
            # the same versioned cache file, reuse it instead of failing the
            # whole AI read with "database is locked / file is occupied".
            if os.path.exists(out_path):
                return out_path
            raise
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
    try:
        stat = os.stat(db_path)
        base, ext = os.path.splitext(safe_rel)
        safe_rel = f"{base}.{int(stat.st_mtime)}-{stat.st_size}{ext or '.db'}"
    except OSError:
        pass
    return os.path.join(DECRYPT_DIR, account["wxid"], safe_rel)


def _decrypted(db_path: str) -> str:
    return _decrypt_db(_key_for_db(db_path), db_path, _cache_path(db_path))


def _connect(db_path: str) -> sqlite3.Connection:
    decrypted = _decrypted(db_path)
    uri = Path(decrypted).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table,),
    ).fetchone()
    return row is not None


def _has_table_like(conn: sqlite3.Connection, pattern: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? LIMIT 1",
        (pattern,),
    ).fetchone()
    return row is not None


def _rows(db_path: str, sql: str, params: tuple = ()) -> list[dict]:
    with _connect(db_path) as conn:
        cur = conn.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


_contacts_cache: dict[str, dict] | None = None
_self_wxids_cache: set[str] | None = None


def _load_contacts() -> dict[str, dict]:
    global _contacts_cache
    if _contacts_cache is not None:
        return _contacts_cache
    contacts: dict[str, dict] = {}
    db_path = _encrypted_contact_db()
    try:
        with _connect(db_path) as conn:
            if _table_exists(conn, "contact"):
                rows = conn.execute("SELECT username, nick_name, remark FROM contact WHERE username!=''").fetchall()
                for row in rows:
                    wxid = (row["username"] or "").strip()
                    if not wxid:
                        continue
                    contacts[wxid] = {
                        "nickname": (row["nick_name"] or "").strip(),
                        "remark": (row["remark"] or "").strip(),
                    }
            elif _table_exists(conn, "Contact"):
                rows = conn.execute("SELECT UserName, NickName, Remark FROM Contact WHERE UserName!=''").fetchall()
                for row in rows:
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
    text = _render_message(msg_type, 0, raw).strip()
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
    db_path = _encrypted_session_db()
    items = []
    with _connect(db_path) as conn:
        if _table_exists(conn, "SessionTable"):
            rows = conn.execute(
                "SELECT username, summary, sort_timestamp, last_msg_type, type, unread_count "
                "FROM SessionTable WHERE is_hidden=0 ORDER BY sort_timestamp DESC LIMIT ?",
                (limit,),
            ).fetchall()
            for row in rows:
                wxid = (row["username"] or "").strip()
                if not wxid:
                    continue
                info = contacts.get(wxid, {})
                msg_type = _safe_int(row["last_msg_type"])
                items.append({
                    "wxid": wxid,
                    "display": _display_name(wxid, info),
                    "nickname": info.get("nickname", ""),
                    "remark": info.get("remark", ""),
                    "has_remark": bool(info.get("remark")),
                    "summary": _summary(row["summary"], msg_type),
                    "last_timestamp": _norm_ts(row["sort_timestamp"]),
                    "last_msg_type": msg_type,
                    "unread_count": _safe_int(row["unread_count"]),
                    "is_group": wxid.endswith("@chatroom"),
                })
            return {"items": items, "total": len(items)}

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
                readable = _table_exists(conn, "MSG") or _has_table_like(conn, "Msg_%")
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
        db_path = _encrypted_session_db()
        with _connect(db_path) as conn:
            if _table_exists(conn, "SessionTable"):
                rows = conn.execute(
                    "SELECT sort_timestamp, last_msg_type FROM SessionTable WHERE username=? LIMIT 1",
                    (wxid,),
                ).fetchall()
                if rows:
                    return {
                        "session_last_timestamp": _norm_ts(rows[0]["sort_timestamp"]),
                        "session_last_msg_type": _safe_int(rows[0]["last_msg_type"]),
                    }
            if _table_exists(conn, "Session"):
                rows = conn.execute(
                    "SELECT nTime, nMsgType FROM Session WHERE strUsrName=? ORDER BY nTime DESC LIMIT 1",
                    (wxid,),
                ).fetchall()
            else:
                rows = []
    except Exception:
        return {}
    if not rows:
        return {}
    return {
        "session_last_timestamp": _norm_ts(rows[0].get("nTime")),
        "session_last_msg_type": _safe_int(rows[0].get("nMsgType")),
    }


def _looks_binary_text(text: str) -> bool:
    if not text:
        return False
    replacement_count = text.count("\ufffd")
    control_count = 0
    visible_count = 0
    for ch in text:
        if ch in ("\n", "\r", "\t"):
            continue
        if unicodedata.category(ch).startswith("C"):
            control_count += 1
        else:
            visible_count += 1
    length = max(len(text), 1)
    if replacement_count >= 3 or replacement_count / length > 0.03:
        return True
    if control_count >= 3 and control_count > visible_count * 0.15:
        return True
    return False


def _render_message(msg_type: int, sub_type: int, content: object) -> str:
    if isinstance(content, (bytes, bytearray)):
        text = bytes(content).decode("utf-8", errors="replace")
    else:
        text = str(content or "")
    text = text.replace("\x00", "").strip()
    if _looks_binary_text(text):
        return MSG_TYPE_PLACEHOLDERS.get(msg_type, "[暂不支持的消息]")
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
    msg_table = f"Msg_{hashlib.md5(wxid.encode()).hexdigest()}"
    for db_path in _encrypted_message_dbs():
        try:
            with _connect(db_path) as conn:
                if _table_exists(conn, "MSG"):
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
                elif _table_exists(conn, msg_table):
                    _wxid_by_table, id_to_wxid = _name2id_maps(conn)
                    where = "create_time < ?" if before_ts > 0 else "1=1"
                    params = [before_ts] if before_ts > 0 else []
                    params.append(limit + 1)
                    rows = conn.execute(
                        f"SELECT local_id, create_time, local_type, real_sender_id, message_content "
                        f"FROM {msg_table} WHERE {where} ORDER BY create_time DESC LIMIT ?",
                        tuple(params),
                    ).fetchall()
                    for row in rows:
                        raw_type = _safe_int(row["local_type"])
                        msg_type = raw_type & 0xFFFF
                        ts = _norm_ts(row["create_time"])
                        sender_info = _sender_info_from_real_id(row["real_sender_id"], wxid, id_to_wxid, contacts)
                        messages.append({
                            "ts": ts,
                            "sender": sender_info["sender"],
                            "sender_wxid": sender_info["sender_wxid"],
                            "sender_display": sender_info["sender_display"],
                            "type": msg_type,
                            "type_label": MSG_TYPE_PLACEHOLDERS.get(msg_type, ""),
                            "content": _render_message(msg_type, 0, row["message_content"]),
                            "has_image": False,
                        })
        except Exception:
            continue

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
    contacts = _load_contacts()
    like = f"%{keyword}%"
    for db_path in _encrypted_message_dbs():
        try:
            with _connect(db_path) as conn:
                if _table_exists(conn, "MSG"):
                    rows = conn.execute(
                        "SELECT CreateTime, Type, SubType, IsSender, StrContent, StrTalker "
                        "FROM MSG WHERE CASE WHEN CreateTime>10000000000 THEN CreateTime>? ELSE CreateTime>? END "
                        "AND StrContent LIKE ? "
                        "ORDER BY CreateTime DESC LIMIT ?",
                        (since_ms, since_sec, like, limit),
                    ).fetchall()
                    for row in rows:
                        msg_type = _safe_int(row["Type"])
                        result.append({
                            "ts": _norm_ts(row["CreateTime"]),
                            "wxid": row["StrTalker"],
                            "sender": "me" if _safe_int(row["IsSender"]) == 1 else "them",
                            "content": _render_message(msg_type, _safe_int(row["SubType"]), row["StrContent"]),
                        })
                else:
                    table_rows = conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'"
                    ).fetchall()
                    wxid_by_table, id_to_wxid = _name2id_maps(conn)
                    for table_row in table_rows:
                        table = str(table_row["name"] or "")
                        wxid = wxid_by_table.get(table, table)
                        rows = conn.execute(
                            f"SELECT create_time, local_type, real_sender_id, message_content "
                            f"FROM {table} WHERE create_time>? AND message_content LIKE ? "
                            f"ORDER BY create_time DESC LIMIT ?",
                            (since, like, limit),
                        ).fetchall()
                        for row in rows:
                            raw_type = _safe_int(row["local_type"])
                            msg_type = raw_type & 0xFFFF
                            sender_info = _sender_info_from_real_id(row["real_sender_id"], wxid, id_to_wxid, contacts)
                            result.append({
                                "ts": _norm_ts(row["create_time"]),
                                "wxid": wxid,
                                "sender": sender_info["sender"],
                                "sender_wxid": sender_info["sender_wxid"],
                                "sender_display": sender_info["sender_display"],
                                "content": _render_message(msg_type, 0, row["message_content"]),
                            })
        except Exception:
            continue
    result.sort(key=lambda item: item["ts"], reverse=True)
    return result[:limit]


def _emit_jsonl(obj: dict) -> None:
    safe_stream_write(sys.stdout, json.dumps(obj, ensure_ascii=False) + "\n")


def _msg_table_wxids(conn: sqlite3.Connection) -> dict[str, str]:
    return _name2id_maps(conn)[0]


def _name2id_maps(conn: sqlite3.Connection) -> tuple[dict[str, str], dict[int, str]]:
    wxid_by_table: dict[str, str] = {}
    id_to_wxid: dict[int, str] = {}
    if not _table_exists(conn, "Name2Id"):
        return wxid_by_table, id_to_wxid
    try:
        for row in conn.execute("SELECT rowid, user_name FROM Name2Id WHERE user_name!=''"):
            username = str(row["user_name"] or "").strip()
            if username:
                wxid_by_table[f"Msg_{hashlib.md5(username.encode()).hexdigest()}"] = username
                id_to_wxid[_safe_int(row["rowid"])] = username
    except Exception:
        return {}, {}
    return wxid_by_table, id_to_wxid


def _self_wxids() -> set[str]:
    global _self_wxids_cache
    if _self_wxids_cache is not None:
        return _self_wxids_cache
    try:
        account = _account()
    except Exception:
        return set()
    candidates = [
        account.get("wxid"),
        account.get("username"),
        account.get("user_name"),
        account.get("account"),
        os.path.basename(str(account.get("wx_dir") or "")),
    ]
    normalized: set[str] = set()
    for item in candidates:
        value = str(item or "").strip().lower()
        if not value:
            continue
        normalized.add(value)
        # Windows WeChat 4.x account folders may be named
        # `<wxid>_<4-hex-suffix>`, while Name2Id stores the plain wxid.
        normalized.add(re.sub(r"_[0-9a-f]{4}$", "", value))
    _self_wxids_cache = normalized
    return _self_wxids_cache


def _sender_info_from_real_id(
    real_sender_id: object,
    chat_wxid: str,
    id_to_wxid: dict[int, str],
    contacts: dict[str, dict],
) -> dict:
    sender_id = _safe_int(real_sender_id)
    sender_wxid = str(id_to_wxid.get(sender_id) or "").strip()
    sender_key = sender_wxid.lower()
    chat_key = str(chat_wxid or "").strip().lower()
    self_wxids = _self_wxids()
    if sender_wxid:
        is_me = sender_key in self_wxids
    else:
        is_me = sender_id == 0
    if sender_wxid and sender_key == chat_key:
        is_me = False
    if is_me:
        return {"sender": "me", "sender_wxid": sender_wxid, "sender_display": "我"}
    display = _display_name(sender_wxid, contacts.get(sender_wxid, {})) if sender_wxid else ""
    return {"sender": "them", "sender_wxid": sender_wxid, "sender_display": display}


def _msg_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'"
    ).fetchall()
    tables = []
    for row in rows:
        table = str(row["name"] or "")
        if re.fullmatch(r"Msg_[0-9a-fA-F]{32}", table):
            tables.append(table)
    return tables


def _iter_db_messages(
    db_path: str,
    since_timestamp: int = 0,
    limit: int = 0,
    allowed_wxids: set[str] | None = None,
) -> list[dict]:
    messages: list[dict] = []
    contacts = _load_contacts()
    since_ms, since_sec = _raw_ts_bounds(since_timestamp)
    with _connect(db_path) as conn:
        if _table_exists(conn, "MSG"):
            where = "StrTalker!=''"
            params: list[Any] = []
            if since_timestamp > 0:
                where += " AND CASE WHEN CreateTime>10000000000 THEN CreateTime>=? ELSE CreateTime>=? END"
                params.extend([since_ms, since_sec])
            if allowed_wxids:
                placeholders = ",".join("?" for _ in allowed_wxids)
                where += f" AND StrTalker IN ({placeholders})"
                params.extend(sorted(allowed_wxids))
            sql = (
                "SELECT CreateTime, Type, SubType, IsSender, StrContent, StrTalker "
                f"FROM MSG WHERE {where} ORDER BY CreateTime DESC"
            )
            if limit > 0:
                sql += " LIMIT ?"
                params.append(limit)
            rows = conn.execute(sql, tuple(params)).fetchall()
            for row in rows:
                wxid = str(row["StrTalker"] or "").strip()
                if not wxid:
                    continue
                msg_type = _safe_int(row["Type"])
                sub_type = _safe_int(row["SubType"])
                content = _render_message(msg_type, sub_type, row["StrContent"]).strip()
                if not content:
                    continue
                info = contacts.get(wxid, {})
                messages.append({
                    "wxid": wxid,
                    "display": _display_name(wxid, info),
                    "is_group": wxid.endswith("@chatroom"),
                    "ts": _norm_ts(row["CreateTime"]),
                    "sender": "me" if _safe_int(row["IsSender"]) == 1 else "them",
                    "sender_wxid": "",
                    "sender_display": "",
                    "type": msg_type,
                    "content": content,
                })
            return messages

        table_names = _msg_tables(conn)
        wxid_by_table, id_to_wxid = _name2id_maps(conn)
        for table in table_names:
            wxid = wxid_by_table.get(table, table)
            if allowed_wxids and wxid not in allowed_wxids:
                continue
            where = "message_content IS NOT NULL AND message_content != ''"
            params = []
            if since_timestamp > 0:
                where += " AND create_time >= ?"
                params.append(since_timestamp)
            sql = (
                f"SELECT create_time, local_type, real_sender_id, message_content "
                f"FROM {table} WHERE {where} ORDER BY create_time DESC"
            )
            if limit > 0:
                sql += " LIMIT ?"
                params.append(limit)
            try:
                rows = conn.execute(sql, tuple(params)).fetchall()
            except Exception:
                continue
            info = contacts.get(wxid, {})
            display = _display_name(wxid, info)
            for row in rows:
                raw_type = _safe_int(row["local_type"])
                msg_type = raw_type & 0xFFFF
                content = _render_message(msg_type, 0, row["message_content"]).strip()
                if not content:
                    continue
                sender_info = _sender_info_from_real_id(row["real_sender_id"], wxid, id_to_wxid, contacts)
                messages.append({
                    "wxid": wxid,
                    "display": display,
                    "is_group": wxid.endswith("@chatroom"),
                    "ts": _norm_ts(row["create_time"]),
                    "sender": sender_info["sender"],
                    "sender_wxid": sender_info["sender_wxid"],
                    "sender_display": sender_info["sender_display"],
                    "type": msg_type,
                    "content": content,
                })
    return messages


def analyze_snapshot(args: dict) -> dict:
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

    sessions = list_sessions({"limit": max(session_limit, 10000)}).get("items") or []
    if session_limit > 0:
        sessions = sessions[:session_limit]
    allowed_wxids = {
        str(item.get("wxid") or "").strip()
        for item in sessions
        if str(item.get("wxid") or "").strip()
    } if session_limit > 0 else None
    session_meta = {
        str(item.get("wxid") or "").strip(): item
        for item in sessions
        if str(item.get("wxid") or "").strip()
    }

    messages: list[dict] = []
    total_readable = 0
    for db_path in _encrypted_message_dbs():
        if len(messages) >= max_messages:
            break
        try:
            rows = _iter_db_messages(
                db_path,
                since_timestamp=since_timestamp,
                limit=0,
                allowed_wxids=allowed_wxids,
            )
        except Exception:
            continue
        total_readable += len(rows)
        if per_session_limit > 0:
            per_wxid: dict[str, int] = {}
            limited = []
            for row in rows:
                wxid = row["wxid"]
                count = per_wxid.get(wxid, 0)
                if count >= per_session_limit:
                    continue
                per_wxid[wxid] = count + 1
                limited.append(row)
            rows = limited
        remaining = max_messages - len(messages)
        messages.extend(rows[:remaining])

    messages.sort(key=lambda item: int(item.get("ts") or 0), reverse=True)
    messages = messages[:max_messages]
    for message in messages:
        meta = session_meta.get(message["wxid"])
        if meta:
            message["display"] = meta.get("display") or message.get("display") or message["wxid"]
            message["is_group"] = bool(meta.get("is_group")) or bool(message.get("is_group"))

    normalized_sessions = []
    for item in sessions:
        wxid = str(item.get("wxid") or "").strip()
        if not wxid:
            continue
        normalized_sessions.append({
            "wxid": wxid,
            "display": item.get("display") or wxid,
            "summary": item.get("summary") or "",
            "last_timestamp": _safe_int(item.get("last_timestamp")),
            "unread_count": _safe_int(item.get("unread_count")),
            "is_group": bool(item.get("is_group")) or wxid.endswith("@chatroom"),
        })

    return {
        "sessions": normalized_sessions,
        "messages": messages,
        "sessions_scanned": len(normalized_sessions),
        "messages_scanned": len(messages),
        "total_readable_messages": total_readable,
        "selected_readable_messages": total_readable,
        "messages_truncated": total_readable > len(messages),
        "scan_scope": "all_readable_wechat_messages" if session_limit <= 0 else "limited_recent_sessions",
        "safety_limit": max_messages,
    }


def sync_stream(args: dict) -> None:
    since_raw = args.get("since_timestamp")
    try:
        since_timestamp = int(since_raw) if since_raw not in (None, "") else 0
    except (TypeError, ValueError):
        since_timestamp = 0
    if since_timestamp < 0:
        since_timestamp = 0

    sessions = list_sessions({"limit": 10000}).get("items") or []
    _emit_jsonl({"type": "meta", "sessions": sessions})

    max_ts_seen = since_timestamp
    grand_total = 0
    for db_path in _encrypted_message_dbs():
        db_name = os.path.basename(db_path)
        try:
            with _connect(db_path) as conn:
                tables = 1 if _table_exists(conn, "MSG") else len(_msg_tables(conn))
        except Exception as err:  # noqa: BLE001
            safe_stream_write(sys.stderr, f"[sync_stream] {db_name} open failed: {err}\n")
            continue
        _emit_jsonl({"type": "db_start", "db": db_name, "tables": tables})
        emitted = 0
        try:
            for row in _iter_db_messages(db_path, since_timestamp=since_timestamp):
                ts = _safe_int(row.get("ts"))
                if ts <= 0:
                    continue
                max_ts_seen = max(max_ts_seen, ts)
                _emit_jsonl({
                    "type": "msg",
                    "wxid": row.get("wxid") or "",
                    "ts": ts,
                    "sender": "me" if row.get("sender") == "me" else "them",
                    "sender_wxid": row.get("sender_wxid") or "",
                    "sender_display": row.get("sender_display") or "",
                    "msg_type": _safe_int(row.get("type")),
                    "content": row.get("content") or "",
                })
                emitted += 1
        except Exception as err:  # noqa: BLE001
            safe_stream_write(sys.stderr, f"[sync_stream] {db_name} failed: {err}\n")
        grand_total += emitted
        _emit_jsonl({"type": "db_done", "db": db_name, "messages": emitted})

    _emit_jsonl({"type": "done", "cursor": max_ts_seen, "messages": grand_total})


def avatar(args: dict) -> dict:
    return {"error": "no_avatar"}


def resolve_image(args: dict) -> dict:
    return {"error": "not_supported"}


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

STREAMING_OPS = {"sync_stream"}


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as err:
        safe_stream_write(sys.stderr, f"invalid json: {err}\n")
        return 1
    op = payload.get("op")
    if op not in OPS:
        safe_stream_write(sys.stderr, f"unknown op: {op!r}\n")
        return 1
    try:
        if op in STREAMING_OPS:
            OPS[op](payload.get("args") or {})
            return 0
        safe_stream_write(sys.stdout, json.dumps(OPS[op](payload.get("args") or {}), ensure_ascii=True))
        return 0
    except Exception as err:  # noqa: BLE001
        safe_stream_write(sys.stderr, f"{type(err).__name__}: {err}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
