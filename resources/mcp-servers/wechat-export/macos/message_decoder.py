"""
WeChat 4.x WCDB message_content decoder.

WCDB stores plain UTF-8 for text (local_type=1) but Zstandard-compressed XML
for everything else (image, video, emoji, app cards, references, etc).

This module provides:

  * `extract_self_wxid(db_path)` — parse the owner's wxid out of the
    `xwechat_files/<wxid>_<suffix>/...` path.
  * `get_my_sender_id_for_db(db_path, key, sqlcipher, self_wxid)` — look up
    the owner's `Name2Id.rowid` *inside that specific db* (rowids aren't
    consistent across `message_*.db` files).
  * `decode_content(local_type, raw)` — zstd-decompress when needed and turn
    each message variant into a short, readable summary line that is safe to
    embed in chat output (so AI tools never see raw XML / binary).

Source-of-truth references:
  * Compression magic 0x28b52ffd is the standard Zstandard frame header.
  * The XML schemas mirror the WeChat 3.x message envelopes that LC044/WeChatMsg
    documents (the 4.x WCDB layer just zstd-wraps the same payloads).
"""

from __future__ import annotations

import os
import re
import subprocess
import xml.etree.ElementTree as ET
from typing import Optional

import zstandard


# Zstandard frame magic (little-endian on disk: 28 b5 2f fd).
_ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


# ---------------------------------------------------------------- self wxid


_SELF_WXID_RE = re.compile(r"xwechat_files/([^/]+?)_[0-9a-f]{4}/db_storage")


def extract_self_wxid(db_path: str) -> Optional[str]:
    """Return the owner's wxid, parsed from the WCDB path. None if not matched."""
    m = _SELF_WXID_RE.search(os.path.abspath(db_path))
    return m.group(1) if m else None


_my_sender_id_per_db: dict[tuple[str, str], int] = {}


def get_my_sender_id_for_db(
    db_path: str,
    sqlcipher_path: str,
    key_hex: str,
    self_wxid: str,
) -> Optional[int]:
    """Look up Name2Id.rowid for the owner inside this specific db.

    Cached per (db_path, self_wxid). rowids differ across message_*.db files,
    so the original `_detect_my_sender_id` heuristic was unreliable.
    """
    cache_key = (db_path, self_wxid)
    if cache_key in _my_sender_id_per_db:
        return _my_sender_id_per_db[cache_key]
    # sqlite dot-commands must be on their own lines, and PRAGMA statements
    # must be terminated; mixing them on one line trips a parse error.
    sql = "\n".join([
        f"PRAGMA key=\"x'{key_hex}'\";",
        "PRAGMA cipher_compatibility=4;",
        "PRAGMA cipher_page_size=4096;",
        f"SELECT rowid FROM Name2Id WHERE user_name = '{self_wxid}';",
    ])
    try:
        result = subprocess.run(
            [sqlcipher_path, db_path],
            input=sql,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        _my_sender_id_per_db[cache_key] = None  # type: ignore[assignment]
        return None
    out = (result.stdout or "").strip().splitlines()
    rowid: Optional[int] = None
    for line in out:
        line = line.strip()
        if line and line.isdigit():
            rowid = int(line)
            break
    _my_sender_id_per_db[cache_key] = rowid  # type: ignore[assignment]
    return rowid


# ---------------------------------------------------------------- decoding


_zstd_dctx = zstandard.ZstdDecompressor()


def _maybe_decompress(raw: bytes) -> bytes:
    """Return zstd-decompressed bytes when the frame magic is present, else raw."""
    if raw.startswith(_ZSTD_MAGIC):
        try:
            return _zstd_dctx.decompress(raw)
        except zstandard.ZstdError:
            return raw
    return raw


def _strip_xml_namespaces(text: str) -> str:
    """Remove xmlns declarations so ElementTree's tag matching stays clean."""
    return re.sub(r'\sxmlns(:\w+)?="[^"]+"', "", text)


def _try_parse_xml(text: str) -> Optional[ET.Element]:
    cleaned = _strip_xml_namespaces(text.strip())
    if not cleaned.startswith("<"):
        return None
    try:
        return ET.fromstring(cleaned)
    except ET.ParseError:
        return None


# Map from (low 16 bits of) local_type → human label.
TYPE_LABELS: dict[int, str] = {
    1: "文本",
    3: "图片",
    34: "语音",
    42: "名片",
    43: "视频",
    47: "表情",
    48: "位置",
    49: "卡片",
    50: "通话",
    10000: "系统",
    10002: "撤回",
}


def _truncate(value: str, max_chars: int = 200) -> str:
    value = value.replace("\n", " ").replace("\r", " ").strip()
    return value if len(value) <= max_chars else value[: max_chars - 1] + "…"


def _summarize_image(root: ET.Element) -> str:
    img = root.find(".//img")
    if img is None:
        return "[图片]"
    md5 = img.get("md5") or ""
    length = img.get("length") or img.get("hevc_mid_size") or ""
    pieces = ["[图片]"]
    if md5:
        pieces.append(f"md5={md5[:8]}…")
    if length:
        pieces.append(f"size={length}B")
    return " ".join(pieces)


def _summarize_video(root: ET.Element) -> str:
    video = root.find(".//videomsg")
    if video is None:
        return "[视频]"
    secs = video.get("playlength") or video.get("length") or ""
    return f"[视频 {secs}s]" if secs else "[视频]"


def _summarize_voice(root: ET.Element) -> str:
    voice = root.find(".//voicemsg")
    if voice is None:
        return "[语音]"
    secs = voice.get("voicelength") or voice.get("length") or ""
    if secs.isdigit():
        return f"[语音 {int(secs) // 1000 or 1}s]"
    return "[语音]"


def _summarize_emoji(root: ET.Element) -> str:
    emoji = root.find(".//emoji")
    if emoji is None:
        return "[表情]"
    desc = emoji.get("desc") or emoji.get("androidmd5") or ""
    return f"[表情 {desc}]" if desc else "[表情]"


def _summarize_appmsg(root: ET.Element) -> str:
    appmsg = root.find(".//appmsg")
    if appmsg is None:
        return "[卡片]"
    title = (appmsg.findtext("title") or "").strip()
    desc = (appmsg.findtext("des") or "").strip()
    url = (appmsg.findtext("url") or "").strip()
    type_node = appmsg.findtext("type") or ""
    label = "卡片"
    if type_node == "5":
        label = "链接"
    elif type_node == "6":
        label = "文件"
        title = (appmsg.findtext("title") or "").strip()
    elif type_node == "8":
        label = "动图"
    elif type_node == "33":
        label = "小程序"
    elif type_node == "57":
        label = "引用"
        # Quoted reply: outer is the user's new message; inner refermsg holds the quoted source.
        new_text = title or desc
        refer = appmsg.find("refermsg")
        if refer is not None:
            quoted = (refer.findtext("content") or "").strip()
            displayname = (refer.findtext("displayname") or "").strip()
            quoted_short = _truncate(quoted, 60)
            sender = displayname or "对方"
            return f"[引用 {sender}『{quoted_short}』] {_truncate(new_text)}"
    parts = [f"[{label}]"]
    if title:
        parts.append(_truncate(title, 80))
    if desc and desc != title:
        parts.append(f"— {_truncate(desc, 80)}")
    if url and label == "链接":
        parts.append(f"({url})")
    return " ".join(parts)


def _summarize_location(root: ET.Element) -> str:
    loc = root.find(".//location")
    if loc is None:
        return "[位置]"
    label = loc.get("label") or loc.get("poiname") or ""
    return f"[位置 {label}]" if label else "[位置]"


def _summarize_xml(local_type: int, root: ET.Element) -> Optional[str]:
    low = local_type & 0xFFFF
    if low == 3:
        return _summarize_image(root)
    if low == 43:
        return _summarize_video(root)
    if low == 34:
        return _summarize_voice(root)
    if low == 47:
        return _summarize_emoji(root)
    if low == 49:
        return _summarize_appmsg(root)
    if low == 48:
        return _summarize_location(root)
    if low == 42:
        nick = ""
        msg = root if root.tag == "msg" else root.find(".//msg")
        if msg is not None:
            nick = msg.get("nickname") or msg.get("nickName") or ""
        return f"[名片 {nick}]" if nick else "[名片]"
    return None


def decode_content(local_type: int | str, raw: object) -> str:
    """Render `message_content` as a short readable line.

    Returns the original UTF-8 for plain text. For non-text messages it
    decompresses zstd and parses the XML envelope into something like
    `[图片 md5=ab12cd34… size=18432B]`. Falls back to a typed placeholder
    when the envelope is unrecognised so the AI never sees raw bytes.
    """
    try:
        type_int = int(local_type)
    except (TypeError, ValueError):
        type_int = 0
    low = type_int & 0xFFFF
    label = TYPE_LABELS.get(low, "其他")

    if raw is None:
        return f"[{label}]"

    # Normalize input — server.py reads message_content via sqlcipher CLI, which
    # returns a str (possibly with stray surrogate escapes for binary blobs).
    if isinstance(raw, str):
        # Re-encode to bytes so we can sniff zstd magic. Use surrogateescape so
        # binary that came out of sqlcipher's lossy text mode round-trips.
        try:
            raw_bytes = raw.encode("utf-8", "surrogateescape")
        except UnicodeEncodeError:
            raw_bytes = raw.encode("utf-8", "ignore")
    elif isinstance(raw, bytes):
        raw_bytes = raw
    else:
        raw_bytes = str(raw).encode("utf-8", "ignore")

    if low == 1 and not raw_bytes.startswith(_ZSTD_MAGIC):
        # Plain text fast path. Use the original str so emoji round-trip cleanly.
        text = raw if isinstance(raw, str) else raw_bytes.decode("utf-8", "replace")
        return _truncate(text, 500)

    payload = _maybe_decompress(raw_bytes)
    try:
        xml_text = payload.decode("utf-8", errors="replace")
    except Exception:
        return f"[{label}]"

    root = _try_parse_xml(xml_text)
    if root is not None:
        summary = _summarize_xml(type_int, root)
        if summary:
            return summary

    # Unrecognised envelope: bail out with a typed placeholder rather than
    # leaking binary into the AI prompt.
    return f"[{label}]"
