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
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

SQLITE_FILE_HEADER = b"SQLite format 3\x00"
PAGE_SIZE = 4096
KEY_SIZE = 32
SALT_SIZE = 16
V3_RESERVED = 48
V4_RESERVED = 80
MESSAGE_DB_RE = re.compile(r"^(?:MSG|message|media|biz_message)(?:_?\d+)?\.db$", re.I)
CHAT_MESSAGE_DB_RE = re.compile(r"^(?:MSG|message)(?:_?\d+)?\.db$", re.I)
FILE_STORAGE_ROOT_NAMES = ("FileStorage", "file_storage")
FILE_STORAGE_NESTED_NAMES = ("File", "Files", "filestorage")
FILE_MESSAGE_TYPE = 49
APPMSG_FILE_TYPES = {"6", "74"}


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


def _encrypted_chat_message_dbs() -> list[str]:
    return [
        db_path
        for db_path in _encrypted_message_dbs()
        if CHAT_MESSAGE_DB_RE.fullmatch(os.path.basename(db_path))
    ]


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
    # Cache paths are versioned by source mtime + size. Treat them as
    # immutable: Windows denies replacing a SQLite file while any reader still
    # holds a handle, even when the connection is read-only.
    if os.path.exists(out_path):
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
            os.rename(tmp_path, out_path)
        except FileExistsError:
            return out_path
        except OSError as err:
            if os.path.exists(out_path):
                return out_path
            raise RuntimeError(f"写入解密缓存失败: {os.path.basename(out_path)}: {err}") from err
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
_local_file_index: dict[str, str] | None = None
_local_file_misses: set[str] = set()


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


def _parse_member_list(raw) -> list[str]:
    """Split a WeChat ChatRoom user list. Membership across WeChat versions
    has been stored as:
      * comma-separated string ("wxid_a,wxid_b,wxid_c")           — 3.x / 4.x
      * 0x07 (^G) separated ("wxid_a\\x07wxid_b\\x07…")             — some 3.x
      * semicolon-separated                                        — DisplayNameList rare
      * protobuf bytes / blob                                      — 4.x RoomData
    We accept all three text separators. Blob input returns []; the caller
    falls back to a different column or to the diagnostic-dump path."""
    if raw is None:
        return []
    if isinstance(raw, bytes):
        # bytes are typically protobuf — try ASCII decode for wxid-looking
        # ASCII substrings; if nothing parses, give up and let diagnostics
        # show the column shape.
        try:
            decoded = raw.decode("utf-8", errors="ignore")
        except Exception:
            return []
        raw = decoded
    if not isinstance(raw, str) or not raw:
        return []
    return [piece.strip() for piece in re.split(r"[,;\x07]", raw) if piece.strip()]


def _gather_group_schema_diagnostic(conn, sample_row_limit: int = 1) -> str:
    """Dump every table on the open contact.db whose name suggests group /
    chatroom / member / contact data, with: column list, row count, and a
    redacted preview of the first non-empty row. The point is to let the
    developer reading the warning fix the probe in one shot — no second build
    cycle just to discover the table layout."""
    lines: list[str] = []
    name_patterns = ('%room%', '%group%', '%member%', '%contact%', '%session%')
    seen: set[str] = set()
    for pat in name_patterns:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND LOWER(name) LIKE ? ORDER BY name",
            (pat,),
        ).fetchall()
        for r in rows:
            name = r["name"]
            if name in seen:
                continue
            seen.add(name)
            try:
                cols = [c[1] for c in conn.execute(f'PRAGMA table_info("{name}")').fetchall()]
            except Exception as e:  # noqa: BLE001
                lines.append(f"  - {name}: schema introspection failed ({e})")
                continue
            try:
                count = conn.execute(f'SELECT COUNT(*) AS n FROM "{name}"').fetchone()["n"]
            except Exception as e:  # noqa: BLE001
                count = f"COUNT? ({e})"
            sample_str = "(no rows)"
            if isinstance(count, int) and count > 0:
                try:
                    sample = conn.execute(f'SELECT * FROM "{name}" LIMIT ?', (sample_row_limit,)).fetchone()
                    if sample is not None:
                        pairs = []
                        for col in cols:
                            try:
                                val = sample[col]
                            except (IndexError, KeyError):
                                pairs.append(f"{col}=<missing>")
                                continue
                            if val is None:
                                pairs.append(f"{col}=NULL")
                            elif isinstance(val, bytes):
                                pairs.append(f"{col}=<bytes len={len(val)}>")
                            elif isinstance(val, str):
                                safe = ''.join(c if c.isprintable() else f'\\x{ord(c):02x}' for c in val[:120])
                                if len(val) > 120:
                                    safe += '…'
                                pairs.append(f'{col}="{safe}"')
                            else:
                                pairs.append(f"{col}={val!r}")
                        sample_str = " | ".join(pairs)
                except Exception as e:  # noqa: BLE001
                    sample_str = f"(sample read failed: {e})"
            lines.append(f"  - {name} (rows={count}) cols={cols}\n      sample: {sample_str}")
    return "\n".join(lines) if lines else "  (no group/room/member/contact-like tables found)"


def _list_groups_via_join_table(conn, members: list[str], match_mode: str) -> dict:
    """Mirror of the macOS schema — normalized chatroom_member join table.

    On Windows WeChat 4.x the layout is identical to macOS:
      chatroom_member(room_id, member_id)
        ⇄ chat_room(id, username='<wxid>@chatroom')
        ⇄ contact(id, username='<wxid>')

    Diagnostic from a real user's contact.db confirmed:
      chatroom_member rows=18847 cols=['room_id', 'member_id']
      chat_room rows=514 cols=['id', 'username', 'owner', 'ext_buffer']
      contact rows=18263 cols=['id', 'username', …]
    """
    in_list = ",".join("?" for _ in members)
    sql = (
        "SELECT cr.username AS room_wxid, c.username AS member_wxid "
        "FROM chatroom_member m "
        "JOIN contact c ON c.id = m.member_id "
        "JOIN chat_room cr ON cr.id = m.room_id "
        f"WHERE c.username IN ({in_list})"
    )
    rows = conn.execute(sql, members).fetchall()
    contacts = _load_contacts()
    groups: dict[str, dict] = {}
    for row in rows:
        room = (row["room_wxid"] or "").strip()
        if not room:
            continue
        member_wxid = (row["member_wxid"] or "").strip()
        bucket = groups.setdefault(room, {"wxid": room, "name": "", "matched_members": []})
        if member_wxid and member_wxid not in bucket["matched_members"]:
            bucket["matched_members"].append(member_wxid)
        if not bucket["name"]:
            info = contacts.get(room, {})
            bucket["name"] = (info.get("remark") or info.get("nickname") or "").strip()
    member_set = set(members)
    out: list[dict] = []
    for bucket in groups.values():
        if match_mode == "all" and not member_set.issubset(set(bucket["matched_members"])):
            continue
        out.append(bucket)
    return {"groups": out, "total": len(out)}


def _list_groups_via_user_list_column(
    conn,
    members: list[str],
    match_mode: str,
    *,
    table: str,
    room_col: str,
    users_col: str,
) -> dict:
    """ChatRoom-style schemas where membership is a delimited string column."""
    # Identifier quoting is critical here — `table` and `*_col` come from our
    # whitelist above (not user input), but quoted defensively.
    rows = conn.execute(
        f'SELECT "{room_col}" AS room_wxid, "{users_col}" AS users_str FROM "{table}"'
    ).fetchall()
    contacts = _load_contacts()
    member_set = set(members)
    out: list[dict] = []
    for row in rows:
        room = (row["room_wxid"] or "").strip()
        users_str = (row["users_str"] or "").strip()
        if not room or not users_str:
            continue
        users_in_room = set(_parse_member_list(users_str))
        matched = sorted(member_set & users_in_room)
        if not matched:
            continue
        if match_mode == "all" and not member_set.issubset(users_in_room):
            continue
        info = contacts.get(room, {})
        out.append({
            "wxid": room,
            "name": (info.get("remark") or info.get("nickname") or "").strip(),
            "matched_members": matched,
        })
    return {"groups": out, "total": len(out)}


def list_groups_with_member(args: dict) -> dict:
    """Find chatrooms where members (by wxid) belong, used by group-tag
    "members' rooms" mode. Equivalent of macOS api.py's list_groups_with_member,
    but Windows WeChat stores membership in several different shapes depending
    on version:

      * WeChat 4.x: `chat_room` table on contact.db with `user_name_list` (and
        often `display_name_list`) columns holding a delimited wxid string.
      * WeChat 3.x: `ChatRoom` (PascalCase) with `UserNameList` / `DisplayNameList`.
      * Some snapshots mirror macOS exactly: a normalized `chat_room_member`
        join table with `room_id`, `member_id` FKs.

    We probe in that order. If none of them match we return an actionable
    diagnostic (the actual table list seen) instead of silently 0-result, so a
    user hitting an unfamiliar layout can paste it back and we extend the
    probe table without needing a separate diagnostics op.
    """
    members = [
        w.strip() for w in (args.get("member_wxids") or [])
        if isinstance(w, str) and w.strip()
    ]
    match_mode = args.get("match_mode") or "any"
    if not members:
        return {"groups": [], "total": 0, "warning": "member_wxids 为空"}

    contact_db = _encrypted_contact_db()
    if not os.path.exists(contact_db):
        return {"groups": [], "total": 0, "warning": "contact.db 不存在"}

    try:
        with _connect(contact_db) as conn:
            schema_hit: str | None = None
            result: dict | None = None

            # 1. Normalized chatroom_member join table — this is what real
            # Windows WeChat 4.x snapshots actually use (confirmed by the
            # contact.db dump returned from a v0.25.57 diagnostic run). The
            # earlier `chat_room_member` spelling was a typo on my part that
            # never matched anything in production.
            if (
                _table_exists(conn, "chatroom_member")
                and _table_exists(conn, "chat_room")
                and _table_exists(conn, "contact")
            ):
                schema_hit = "chatroom_member (mirror macOS join)"
                result = _list_groups_via_join_table(conn, members, match_mode)

            # 2. WeChat 4.x with a delimited user_name_list column instead of
            # the join table (historical / alternate). On the contact.db we
            # actually saw, `chat_room` has only id/username/owner/ext_buffer
            # — no user_name_list — so this branch falls through to the
            # diagnostic; it remains as a forward-compat probe.
            elif _table_exists(conn, "chat_room"):
                schema_hit = "chat_room (snake_case)"
                result = _list_groups_via_user_list_column(
                    conn, members, match_mode,
                    table="chat_room", room_col="username", users_col="user_name_list",
                )

            # 3. WeChat 3.x PascalCase
            elif _table_exists(conn, "ChatRoom"):
                schema_hit = "ChatRoom (PascalCase)"
                result = _list_groups_via_user_list_column(
                    conn, members, match_mode,
                    table="ChatRoom", room_col="ChatRoomName", users_col="UserNameList",
                )

            if result is None:
                # No probe hit — dump every plausible table so the dev
                # adapting the probe has full information in one shot.
                return {
                    "groups": [], "total": 0,
                    "warning": (
                        "未识别到 ChatRoom 表结构。contact.db 候选表 dump:\n"
                        + _gather_group_schema_diagnostic(conn)
                        + "\n→ 把这段完整发给 Lumos 开发者以适配。"
                    ),
                }

            # Probe matched a schema but the actual query returned 0 — this is
            # the case the user just hit. Surface the same full diagnostic so
            # the dev can tell which column / format actually holds members on
            # this WeChat build (e.g. RoomData protobuf, different separator,
            # wxid suffix mismatch, table empty, etc.).
            if result["total"] == 0:
                result["warning"] = (
                    f"匹配到 0 群。命中 schema = {schema_hit}。\n"
                    f"查询的 member_wxids = {members}\n"
                    "contact.db 候选表 dump(用于排查真实字段名/分隔符/格式):\n"
                    + _gather_group_schema_diagnostic(conn)
                    + "\n→ 把这段完整发给 Lumos 开发者。"
                )
            return result
    except Exception as e:  # noqa: BLE001
        return {"groups": [], "total": 0, "warning": f"查询失败：{e}"}


def resolve_contact(args: dict) -> dict:
    """Resolve a fuzzy name (remark / nickname / wxid fragment) to *person*
    contact candidates. Used by the group-tag member picker so a tag rule can
    pin the exact wxid (stable) instead of a drifting display name. Excludes
    groups (@chatroom) and official accounts (gh_) — they aren't group
    "members".

    Mirrors the macOS implementation in macos/api.py so both platforms expose
    the same op surface to src/app/api/apps/builtin/wechat/group-tags/resolve-
    contact/route.ts. Without this op the Windows UI showed `unknown op:
    'resolve_contact'` whenever the user typed a name into the picker.
    """
    query = (args.get("query") or "").strip().lower()
    limit = max(1, min(int(args.get("limit") or 10), 50))
    contacts = _load_contacts()
    items: list[dict] = []
    for wxid, info in contacts.items():
        if "@chatroom" in wxid or wxid.startswith("gh_"):
            continue
        nick = (info.get("nickname") or "").strip()
        remark = (info.get("remark") or "").strip()
        if query and query not in f"{wxid} {nick} {remark}".lower():
            continue
        items.append({
            "wxid": wxid,
            "display": remark or nick or wxid,
            "nickname": nick,
            "remark": remark,
            "has_remark": bool(remark),
        })
    items.sort(key=lambda x: (not x["has_remark"], x["display"].lower()))
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
        name = os.path.basename(db_path)
        role = "chat" if CHAT_MESSAGE_DB_RE.fullmatch(name) else "media"
        readable = False
        error = ""
        latest_ts = 0
        if role == "chat":
            try:
                with _connect(db_path) as conn:
                    readable = _table_exists(conn, "MSG") or _has_table_like(conn, "Msg_%")
                    if readable:
                        latest_ts = _latest_message_timestamp(conn)
                    else:
                        error = "数据库已打开，但未识别到普通聊天消息表"
            except Exception as err:  # noqa: BLE001
                error = str(err)
        try:
            mtime = int(os.path.getmtime(db_path))
        except OSError:
            mtime = 0
        items.append({
            "name": name,
            "path": db_path,
            "role": role,
            "readable": readable,
            "mtime": mtime,
            "latest_message_timestamp": latest_ts,
            "error": error,
        })
    return items


def _latest_message_timestamp(conn: sqlite3.Connection) -> int:
    latest = 0
    if _table_exists(conn, "MSG"):
        try:
            row = conn.execute("SELECT MAX(CreateTime) AS ts FROM MSG").fetchone()
            latest = max(latest, _norm_ts(row["ts"] if row else 0))
        except Exception:
            pass
        return latest

    for table in _msg_tables(conn):
        try:
            row = conn.execute(f"SELECT MAX(create_time) AS ts FROM {table}").fetchone()
            latest = max(latest, _norm_ts(row["ts"] if row else 0))
        except Exception:
            continue
    return latest


def _latest_session_timestamp() -> int:
    try:
        db_path = _encrypted_session_db()
        with _connect(db_path) as conn:
            if _table_exists(conn, "SessionTable"):
                row = conn.execute("SELECT MAX(sort_timestamp) AS ts FROM SessionTable").fetchone()
                return _norm_ts(row["ts"] if row else 0)
            if _table_exists(conn, "Session"):
                row = conn.execute("SELECT MAX(nTime) AS ts FROM Session").fetchone()
                return _norm_ts(row["ts"] if row else 0)
    except Exception:
        return 0
    return 0


def _message_db_diagnostics() -> dict:
    items = _message_db_status()
    chat_items = [item for item in items if item["role"] == "chat"]
    media_items = [item for item in items if item["role"] != "chat"]
    readable = [item for item in chat_items if item["readable"]]
    skipped = [item for item in chat_items if not item["readable"]]
    latest_readable_ts = max((item.get("latest_message_timestamp", 0) for item in readable), default=0)
    return {
        "message_db_total": len(chat_items),
        "message_db_readable": len(readable),
        "message_db_unreadable": len(skipped),
        "message_db_names": [item["name"] for item in chat_items],
        "readable_message_db_names": [item["name"] for item in readable],
        "skipped_message_db_names": [item["name"] for item in skipped],
        "media_db_total": len(media_items),
        "media_db_names": [item["name"] for item in media_items],
        "latest_message_db_mtime": max((item["mtime"] for item in items), default=0),
        "latest_readable_message_timestamp": latest_readable_ts,
        "latest_session_timestamp": _latest_session_timestamp(),
        "message_db_statuses": [
            {
                "name": item["name"],
                "role": item["role"],
                "readable": item["readable"],
                "mtime": item["mtime"],
                "latest_message_timestamp": item.get("latest_message_timestamp", 0),
                "error": item.get("error", ""),
            }
            for item in items
        ],
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


def _message_text(content: object) -> str:
    if isinstance(content, (bytes, bytearray)):
        text = bytes(content).decode("utf-8", errors="replace")
    else:
        text = str(content or "")
    return text.replace("\x00", "").strip()


def _parse_xml_fragment(text: str) -> ET.Element | None:
    if not text or "<" not in text:
        return None
    start = text.find("<")
    fragment = text[start:].strip()
    try:
        return ET.fromstring(fragment)
    except ET.ParseError:
        return None


def _find_text(root: ET.Element, path: str) -> str:
    value = root.findtext(path) or ""
    return value.strip()


def _safe_rel_parts(value: str) -> list[str]:
    parts: list[str] = []
    normalized = value.replace("\\", "/")
    for part in normalized.split("/"):
        clean = part.strip()
        if not clean or clean in {".", ".."}:
            continue
        parts.append(clean)
    return parts


def _safe_filename(value: str) -> str:
    name = os.path.basename(value.replace("\\", "/")).strip()
    if name in {"", ".", ".."}:
        return ""
    return name


def _format_bytes(size: int) -> str:
    if size <= 0:
        return ""
    units = ["B", "KB", "MB", "GB"]
    value = float(size)
    unit = units[0]
    for unit in units:
        if value < 1024 or unit == units[-1]:
            break
        value /= 1024
    if unit == "B":
        return f"{int(value)}B"
    return f"{value:.1f}{unit}"


def _file_storage_roots() -> list[str]:
    account = _account()
    roots: list[str] = []
    seen: set[str] = set()
    wx_dir = str(account.get("wx_dir") or "").strip()
    msg_dir = str(account.get("msg_dir") or "").strip()
    candidates: list[str] = []
    for base in [
        wx_dir,
        os.path.dirname(wx_dir) if wx_dir else "",
        msg_dir,
        os.path.dirname(msg_dir) if msg_dir else "",
    ]:
        if not base:
            continue
        for root_name in FILE_STORAGE_ROOT_NAMES:
            candidates.append(os.path.join(base, root_name))
        for nested_name in FILE_STORAGE_NESTED_NAMES:
            candidates.append(os.path.join(base, nested_name))
    for base_raw in candidates:
        base = str(base_raw or "").strip()
        if not base or not os.path.isdir(base):
            continue
        normalized = os.path.normcase(os.path.abspath(base))
        if normalized not in seen:
            seen.add(normalized)
            roots.append(base)
    return roots


def _find_local_file_by_names(names: list[str]) -> str | None:
    global _local_file_index, _local_file_misses
    if _local_file_index is not None:
        for name in names:
            cached = _local_file_index.get(name)
            if cached:
                return cached
    else:
        _local_file_index = {}

    target_names = {name for name in names if name not in _local_file_misses}
    if not target_names:
        return None

    for root in _file_storage_roots():
        for walk_root, _, files in os.walk(root):
            for name in files:
                if name in target_names:
                    path_value = os.path.join(walk_root, name)
                    _local_file_index[name] = path_value
                    return path_value

    _local_file_misses.update(target_names)
    return None


def _find_local_file(title: str, attach_id: str = "") -> str | None:
    names = [_safe_filename(title), *[_safe_filename(part) for part in _safe_rel_parts(attach_id) if "." in part]]
    names = [name for name in dict.fromkeys(names) if name]
    if not names:
        return None
    return _find_local_file_by_names(names)


def _extract_attachment(msg_type: int, content: object) -> dict | None:
    if msg_type != FILE_MESSAGE_TYPE:
        return None
    text = _message_text(content)
    root = _parse_xml_fragment(text)
    if root is None:
        return None
    appmsg = root.find(".//appmsg")
    if appmsg is None:
        return None
    app_type = (_find_text(appmsg, "type") or "").strip()
    title = _find_text(appmsg, "title")
    attach_id = _find_text(appmsg, "attachid")
    file_ext = _find_text(appmsg, "fileext")
    size = _safe_int(_find_text(appmsg, "totallen"))
    is_file = app_type in APPMSG_FILE_TYPES or bool(file_ext) or size > 0
    if not is_file:
        return None
    local_path = _find_local_file(title, attach_id)
    title = os.path.basename(title) if title else "微信文件"
    return {
        "kind": "file",
        "title": title,
        "size": size,
        "size_label": _format_bytes(size),
        "ext": file_ext,
        "attach_id": attach_id,
        "local_path": local_path or "",
        "exists": bool(local_path and os.path.exists(local_path)),
    }


def _attachment_summary(attachment: dict | None) -> str:
    if not attachment:
        return ""
    title = str(attachment.get("title") or "微信文件").strip()
    size = str(attachment.get("size_label") or "").strip()
    suffix = f" · {size}" if size else ""
    status = " · 本地可打开" if attachment.get("exists") else " · 本地文件未定位"
    return f"[文件] {title}{suffix}{status}"


def _render_message(msg_type: int, sub_type: int, content: object) -> str:
    attachment = _extract_attachment(msg_type, content)
    if attachment:
        return _attachment_summary(attachment)
    text = _message_text(content)
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
    for db_path in _encrypted_chat_message_dbs():
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
                        attachment = _extract_attachment(msg_type, row["StrContent"])
                        messages.append({
                            "ts": ts,
                            "sender": "me" if _safe_int(row["IsSender"]) == 1 else "them",
                            "type": msg_type,
                            "type_label": MSG_TYPE_PLACEHOLDERS.get(msg_type, ""),
                            "content": _render_message(msg_type, sub_type, row["StrContent"]),
                            "attachment": attachment,
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
                        attachment = _extract_attachment(msg_type, row["message_content"])
                        messages.append({
                            "ts": ts,
                            "sender": sender_info["sender"],
                            "sender_wxid": sender_info["sender_wxid"],
                            "sender_display": sender_info["sender_display"],
                            "type": msg_type,
                            "type_label": MSG_TYPE_PLACEHOLDERS.get(msg_type, ""),
                            "content": _render_message(msg_type, 0, row["message_content"]),
                            "attachment": attachment,
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
    for db_path in _encrypted_chat_message_dbs():
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
                attachment = _extract_attachment(msg_type, row["StrContent"])
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
                    "attachment": attachment,
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
                attachment = _extract_attachment(msg_type, row["message_content"])
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
                    "attachment": attachment,
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
    for db_path in _encrypted_chat_message_dbs():
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
    for db_path in _encrypted_chat_message_dbs():
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
                    "attachment": row.get("attachment") or None,
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
    "resolve_contact": resolve_contact,
    "list_groups_with_member": list_groups_with_member,
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
