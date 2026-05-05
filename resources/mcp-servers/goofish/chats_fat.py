#!/usr/bin/env python3
"""Fat chats list — pull baseline + WS push, return enriched session list in
ONE shot. Replaces our previous "list-chats then 21x history calls" pipeline.

Why: goofish-cli's `list-chats --watch-secs N` returns watch records as bare
cid skeletons (no peer_nick / preview / ts). To enrich, we used to call
`message history` per cid. But the WS pushes ALREADY contain everything we
need — peer info, item info, message content, timestamp — they're just
parsed away by goofish-cli. This script taps the same WS and keeps it all.

What we extract per session (when WS pushes carry it):
  - peer_user_id           senderInfo.senderUserId / decoded "1.1.1"
  - peer_nick              reminder.reminderTitle when it's a real message
  - last_msg               message text (from textCard / text / custom payload)
  - last_msg_ts            VULCAN_CREATE_TIME / decoded "1.5"
  - item_id, item_title,
    item_main_pic          new_msg_lite "3" object (the rich notification)
  - read_msg_ids           from read_receipt push (for ✓/✓✓ later)

Output format (newline-delimited JSON to stdout):
  {"sessions": [...], "read_receipts": {cid: [msgIds]}, "items": {cid: {...}}}
"""
from __future__ import annotations

# See qr_login_fat.py header — Lumos passes LUMOS_USER_SITE so we can
# import goofish_cli even when HOME is overridden for account isolation.
import os, sys
_us = os.environ.get('LUMOS_USER_SITE')
if _us and _us not in sys.path:
    sys.path.insert(0, _us)

import argparse
import asyncio
import base64
import json
import sys
import time
from contextlib import suppress
from typing import Any


def _import_cli():
    from goofish_cli.core.session import Session  # noqa: F401
    from goofish_cli.core.token import IM_APP_KEY, get_access_token  # noqa: F401
    from goofish_cli.core.sign import generate_mid  # noqa: F401
    from goofish_cli.core.ws import (  # noqa: F401
        connect, build_ack, heartbeat_loop, extract_push_messages,
    )
    from goofish_cli.core.mtop import call  # noqa: F401
    return locals()


async def collect(fetch_num: int, watch_secs: float) -> dict[str, Any]:
    mod = _import_cli()
    Session = mod['Session']
    IM_APP_KEY = mod['IM_APP_KEY']
    get_access_token = mod['get_access_token']
    generate_mid = mod['generate_mid']
    connect = mod['connect']
    build_ack = mod['build_ack']
    heartbeat_loop = mod['heartbeat_loop']
    extract_push_messages = mod['extract_push_messages']
    mtop_call = mod['call']

    session = Session.load()
    my_unb = str(session.unb)

    # 1. Baseline session list (HTTP). Same call goofish-cli's list-chats does.
    baseline_raw = mtop_call(
        session,
        api="mtop.taobao.idlemessage.pc.session.sync",
        data={"fetchNum": int(fetch_num)},
        version="3.0",
        spm_cnt="a21ybx.im.0.0",
    )
    baseline_sessions = (baseline_raw.get("data") or {}).get("sessions") or []

    # 2. WS push collection.
    enrichment: dict[str, dict[str, Any]] = {}  # cid -> partial fields
    items: dict[str, dict[str, Any]] = {}
    read_receipts: dict[str, list[str]] = {}

    if watch_secs > 0:
        token = get_access_token(session)
        async with connect(session) as ws:
            reg = {
                "lwp": "/reg",
                "headers": {
                    "cache-header": "app-key token ua wv",
                    "app-key": IM_APP_KEY,
                    "token": token,
                    "ua": "x", "dt": "j", "wv": "im:3,au:3,sy:6",
                    "sync": "0,0;0;0;",
                    "did": session.device_id,
                    "mid": generate_mid(),
                },
            }
            await ws.send(json.dumps(reg))
            ack = {
                "lwp": "/r/SyncStatus/ackDiff",
                "headers": {"mid": generate_mid()},
                "body": [{
                    "pipeline": "sync", "tooLong2Tag": "PNM,1",
                    "channel": "sync", "topic": "sync",
                    "highPts": 0, "pts": 0, "seq": 0,
                    "timestamp": int(time.time() * 1000),
                }],
            }
            await ws.send(json.dumps(ack))

            hb = asyncio.create_task(heartbeat_loop(ws))
            deadline = time.time() + float(watch_secs)
            try:
                while time.time() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.time()))
                    except (asyncio.TimeoutError, TimeoutError):
                        break
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    with suppress(Exception):
                        await ws.send(json.dumps(build_ack(msg)))
                    for d in extract_push_messages(msg):
                        if isinstance(d, dict):
                            _absorb(d, my_unb, enrichment, items, read_receipts)
            finally:
                hb.cancel()

    # 3. Merge — baseline + WS-only cids.
    sessions: list[dict[str, Any]] = []
    seen_cids: set[str] = set()
    for s in baseline_sessions:
        sess = s.get("session") or {}
        cid = str(sess.get("sessionId", ""))
        if not cid:
            continue
        seen_cids.add(cid)
        # Disambiguate peer: userInfo is the BUYER, ownerInfo is the SELLER.
        # The peer is whichever side isn't us. Goofish-cli's own parser always
        # uses userInfo, so it shows my own masked nick when I'm the buyer —
        # we fix that here.
        ui = sess.get("userInfo") or {}
        oi = sess.get("ownerInfo") or {}
        peer = oi if str(ui.get("userId", "")) == my_unb else ui
        item_info_raw = sess.get("itemInfo") or {}
        summary = ((s.get("message") or {}).get("summary")) or {}
        ws_extra = enrichment.get(cid, {})
        ws_item = items.get(cid, {})
        sessions.append({
            "session_id": cid,
            "session_type": sess.get("sessionType", 0),
            "peer_user_id": str(peer.get("userId", "")) or ws_extra.get("peer_user_id", ""),
            "peer_nick": peer.get("fishNick") or peer.get("nick", "") or ws_extra.get("peer_nick", ""),
            "peer_avatar": peer.get("logo", ""),
            "unread": summary.get("unread", 0),
            "last_msg": summary.get("summary", "") or ws_extra.get("last_msg", ""),
            "ts": summary.get("ts", 0) or ws_extra.get("last_msg_ts", 0),
            "item_id": str(item_info_raw.get("itemId", "") or ws_item.get("item_id", "")),
            "item_title": ws_item.get("item_title", ""),
            "item_main_pic": item_info_raw.get("mainPic", "") or ws_item.get("item_main_pic", ""),
            "source": "baseline",
        })

    for cid, ws_extra in enrichment.items():
        if cid in seen_cids:
            continue
        item_info = items.get(cid, {})
        sessions.append({
            "session_id": cid,
            "session_type": ws_extra.get("session_type", 0),
            "peer_user_id": ws_extra.get("peer_user_id", ""),
            "peer_nick": ws_extra.get("peer_nick", ""),
            "peer_avatar": "",  # WS pushes don't carry logo URLs — frontend falls back to default
            "unread": 0,
            "last_msg": ws_extra.get("last_msg", ""),
            "ts": ws_extra.get("last_msg_ts", 0),
            "item_id": item_info.get("item_id", ""),
            "item_title": item_info.get("item_title", ""),
            "item_main_pic": item_info.get("item_main_pic", ""),
            "source": "watch",
        })

    return {"sessions": sessions, "read_receipts": read_receipts}


def _absorb(d: dict[str, Any], my_unb: str, enrichment: dict[str, dict[str, Any]], items: dict[str, dict[str, Any]], read_receipts: dict[str, list[str]]) -> None:
    """Pull whatever useful fields a single push frame carries."""
    # —— new_msg_lite (rich notification with item) ——
    if isinstance(d.get('1'), str) and d['1'].endswith('@goofish'):
        cid = d['1'].split('@')[0]
        meta = d.get('3')
        ts = int(d.get('4') or 0) if str(d.get('4', '')).isdigit() else 0
        if isinstance(meta, dict):
            ext_uid = str(meta.get('extUserId', ''))
            owner = str(meta.get('ownerUserId', ''))
            peer = ext_uid if ext_uid != my_unb else owner
            slot = enrichment.setdefault(cid, {})
            if peer:
                slot.setdefault('peer_user_id', peer)
            if ts:
                slot['last_msg_ts'] = max(slot.get('last_msg_ts', 0), ts)
            if meta.get('itemId'):
                items[cid] = {
                    'item_id': str(meta.get('itemId', '')),
                    'item_title': meta.get('itemTitle', ''),
                    'item_main_pic': meta.get('itemMainPic', ''),
                }
        return

    # —— read receipt ——
    if isinstance(d.get('1'), list) and isinstance(d.get('3'), str) and d['3'].endswith('@goofish'):
        cid = d['3'].split('@')[0]
        ids = [m for m in d['1'] if isinstance(m, str)]
        if ids:
            read_receipts.setdefault(cid, []).extend(ids)
        return

    # —— operation push (real new message with content) ——
    op = d.get('operation') if isinstance(d, dict) else None
    if isinstance(op, dict):
        sess = op.get('sessionInfo') or {}
        sender = op.get('senderInfo') or {}
        content = op.get('content') or {}
        reminder = content.get('reminder') or {}
        cid = str(d.get('sessionId') or sess.get('sessionId') or '')
        if not cid:
            return
        slot = enrichment.setdefault(cid, {})
        slot.setdefault('session_type', sess.get('sessionType', 0))
        send_uid = str(sender.get('senderUserId', '') or reminder.get('senderUserId', ''))
        if send_uid and send_uid != my_unb:
            slot.setdefault('peer_user_id', send_uid)
            title = reminder.get('reminderTitle', '')
            if title and content.get('contentType') in (1, 2, 7):
                slot.setdefault('peer_nick', title)
        # extract latest message preview
        ct = content.get('contentType')
        text = ''
        if ct == 1:
            text = (content.get('text') or {}).get('text', '')
        elif ct == 101:
            custom = content.get('custom') or {}
            data_b64 = custom.get('data', '')
            if data_b64:
                try:
                    payload = json.loads(base64.b64decode(data_b64))
                    text = (payload.get('text') or {}).get('text', '') or payload.get('summary', '')
                except Exception:
                    pass
            text = text or custom.get('summary', '')
        text = text or reminder.get('reminderContent', '')
        if text:
            slot['last_msg'] = text
        return

    # —— old decrypted format (numeric keys: "1.1.1" sender, "1.2" cid, "1.5" ts, "1.6" content) ——
    one = d.get('1') if isinstance(d, dict) else None
    if isinstance(one, dict) and isinstance(one.get('2'), str) and one['2'].endswith('@goofish'):
        cid = one['2'].split('@')[0]
        sender_node = one.get('1') or {}
        sender_str = sender_node.get('1', '') if isinstance(sender_node, dict) else ''
        send_uid = sender_str.split('@')[0] if sender_str.endswith('@goofish') else ''
        ts = int(one.get('5') or 0) if str(one.get('5', '')).isdigit() else 0
        slot = enrichment.setdefault(cid, {})
        if ts:
            slot['last_msg_ts'] = max(slot.get('last_msg_ts', 0), ts)
        if send_uid and send_uid != my_unb:
            slot.setdefault('peer_user_id', send_uid)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--fetch-num', type=int, default=100)
    p.add_argument('--watch-secs', type=float, default=8.0)
    a = p.parse_args()
    try:
        result = asyncio.run(collect(a.fetch_num, a.watch_secs))
    except ModuleNotFoundError as e:
        sys.stderr.write(f'goofish_cli not importable from {sys.executable}: {e}\n')
        return 127
    except Exception as e:
        sys.stderr.write(f'chats_fat failed: {e}\n')
        return 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
