#!/usr/bin/env python3
"""Fat history fetcher — reuses goofish-cli's WS + auth but returns ALL the
fields the upstream `goofish message history` command throws away.

The official command keeps only `send_user_id / send_user_name / message`
and within `message.content.custom.data` only the inner payload. The actual
WS frame from `/r/MessageManager/listUserMessages` includes:

  - `message.createAt`   (millisecond unix ts)   ← upstream drops this
  - `message.extension.*` (sender uid, reminder title, item id, biz tag)
  - `message.content.contentType`                ← upstream drops this top
                                                   level (the inner one in
                                                   `custom.data` is preferred
                                                   but they're often equal)

This script is invoked by Lumos's API route as a sidecar — same way the
official `goofish-mcp` is invoked by `launcher.mjs`. JSON to stdout, errors
to stderr + non-zero exit.

Usage:
    python3 history_fat.py --cid <CID> [--limit 50]
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
from contextlib import suppress
from typing import Any

# Late import so missing-dep errors land in stderr, not at module load.
def _import_cli():
    from goofish_cli.core.session import Session  # noqa: F401
    from goofish_cli.core.token import get_access_token  # noqa: F401
    from goofish_cli.core.sign import generate_mid  # noqa: F401
    from goofish_cli.core.ws import connect, register, heartbeat_loop, build_ack  # noqa: F401
    return Session, get_access_token, generate_mid, connect, register, heartbeat_loop, build_ack


async def fetch_history(cid: str, limit: int) -> list[dict[str, Any]]:
    Session, get_access_token, generate_mid, connect, register, heartbeat_loop, build_ack = _import_cli()
    session = Session.load()
    token = get_access_token(session)
    send_mid = generate_mid()
    req = {
        "lwp": "/r/MessageManager/listUserMessages",
        "headers": {"mid": send_mid},
        "body": [f"{cid}@goofish", False, 9007199254740991, limit, False],
    }
    out: list[dict[str, Any]] = []
    async with connect(session) as ws:
        await register(ws, session, token)
        hb = asyncio.create_task(heartbeat_loop(ws))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                with suppress(Exception):
                    await ws.send(json.dumps(build_ack(msg)))
                if msg.get("lwp") == "/s/vulcan":
                    await ws.send(json.dumps(req))
                    continue
                if (msg.get("headers") or {}).get("mid", "") != send_mid:
                    continue
                models = (msg.get("body") or {}).get("userMessageModels") or []
                for um in models:
                    parsed = _parse_model(um)
                    if parsed is not None:
                        out.append(parsed)
                return out
        finally:
            hb.cancel()
    return out


def _parse_model(um: dict[str, Any]) -> dict[str, Any] | None:
    """Extract the union of useful fields. Tolerant — missing pieces → None."""
    try:
        m = um["message"]
        ext = m.get("extension") or {}
        content = m.get("content") or {}
        custom = content.get("custom") or {}
        # Inner payload is base64-encoded JSON (the same payload upstream
        # already extracts under `custom.data`).
        inner: dict[str, Any] = {}
        b64 = custom.get("data")
        if isinstance(b64, str):
            try:
                inner = json.loads(base64.b64decode(b64).decode("utf-8"))
            except Exception:
                inner = {"_raw_b64": b64}
        # readStatus is at the userMessageModel top level (not inside message).
        # 1 = read, 2 = unread (observed). Surface it so the UI can show ✓ / ✓✓.
        read_status = int(um.get("readStatus") or 0)
        return {
            "message_id": m.get("messageId") or "",
            "created_at": int(m.get("createAt") or 0),
            "send_user_id": str(ext.get("senderUserId") or ""),
            "send_user_name": ext.get("reminderTitle") or "",
            "receiver_user_id": str(ext.get("receiver") or ""),
            "read_status": read_status,
            "summary": custom.get("summary") or "",
            "outer_content_type": int(content.get("contentType") or 0),
            "message": inner,
        }
    except Exception as e:
        sys.stderr.write(f"[history_fat] skip malformed model: {e}\n")
        return None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--cid", required=True)
    p.add_argument("--limit", type=int, default=50)
    a = p.parse_args()
    try:
        items = asyncio.run(fetch_history(a.cid, a.limit))
    except ModuleNotFoundError as e:
        sys.stderr.write(f"goofish_cli not importable from {sys.executable}: {e}\n")
        return 127
    except Exception as e:
        sys.stderr.write(f"history_fat failed: {e}\n")
        return 1
    sys.stdout.write(json.dumps({"messages": items}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
