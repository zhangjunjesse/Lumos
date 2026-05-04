#!/usr/bin/env python3
"""Patient QR login — replaces goofish-cli's `auth login --qr`.

Why we don't just call upstream:
  - upstream's `_wait_for_qr` has a hardcoded 15s timeout for the QR canvas;
    if anything is slow (passport iframe lazy load, network, risk control
    redirect), the window closes before the user can do anything.
  - upstream only watches for QR; if the user wants to type password instead,
    upstream may or may not honor it.

Our version:
  1. Open a tmp-profile Playwright Chrome (clean — no leaked cookies).
  2. Navigate to https://www.goofish.com (passport iframe lazy-loads here).
  3. POLL cookies every 2 seconds for up to `--timeout` seconds. The browser
     stays open the entire time. User does whatever — scan QR, type password,
     scan again, click "快速进入" — we don't care, we just watch the cookie jar.
  4. When _m_h5_tk + unb + cookie2 are all present, we capture and write to
     ~/.goofish-cli/cookies.json in the format goofish-cli expects.
  5. On timeout, exit non-zero with a clear error.
"""
from __future__ import annotations

# Lumos overrides HOME for per-account isolation; that breaks Python's
# user-site resolution and goofish_cli (installed in the *real* user-site)
# becomes unimportable. We prepend the real user-site (passed via env)
# *before* any third-party imports so the sidecar always finds it.
import os, sys
_us = os.environ.get('LUMOS_USER_SITE')
if _us and _us not in sys.path:
    sys.path.insert(0, _us)

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from contextlib import suppress
from pathlib import Path
from typing import Any

HOME_URL = "https://www.goofish.com"
REQUIRED = ("_m_h5_tk", "unb", "cookie2")


async def collect_until_logged_in(timeout_secs: int) -> dict[str, str]:
    # Late import so missing playwright lands in stderr, not at module load.
    from playwright.async_api import async_playwright

    profile_dir = Path(tempfile.mkdtemp(prefix='qr-login-', dir=str(Path.home() / '.goofish-cli' / 'profiles')))
    try:
        async with async_playwright() as pw:
            context = await pw.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                channel='chrome',
                headless=False,
                viewport={'width': 1280, 'height': 900},
                locale='zh-CN',
                timezone_id='Asia/Shanghai',
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-default-browser-check',
                    '--no-first-run',
                ],
            )
            page = context.pages[0] if context.pages else await context.new_page()
            await page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
            )

            # Land on the homepage. Passport iframe will appear if not logged in.
            with suppress(Exception):
                await page.goto(HOME_URL, wait_until='domcontentloaded', timeout=20000)

            sys.stderr.write(f'[qr] window open, waiting up to {timeout_secs}s for cookies…\n')
            deadline = time.time() + timeout_secs
            while time.time() < deadline:
                await asyncio.sleep(2)
                cookies = await context.cookies()
                cmap = {c.get('name'): c.get('value') for c in cookies if c.get('value')}
                if all(k in cmap for k in REQUIRED):
                    # Got everything we need. Give the page a tiny moment to
                    # finish any post-login navigation that might Set-Cookie
                    # additional fields (sgcookie, _tb_token_, x5sec).
                    await asyncio.sleep(2)
                    cookies = await context.cookies()
                    return {c['name']: c['value'] for c in cookies if c.get('value')}
            return {}
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)


def _import_session_module():
    """Use goofish-cli's session writer so we serialize in their exact format."""
    from goofish_cli.core.session import write_cookies_json
    return write_cookies_json


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--timeout', type=int, default=300, help='秒数，默认 300（5 分钟）')
    p.add_argument('--cookies-out', help='cookies.json 输出路径；不传则用默认 ~/.goofish-cli/cookies.json')
    a = p.parse_args()
    try:
        write_cookies_json = _import_session_module()
    except ModuleNotFoundError as e:
        sys.stderr.write(f'goofish_cli not importable: {e}\n')
        return 127

    try:
        cookies = asyncio.run(collect_until_logged_in(a.timeout))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'qr_login_fat failed: {type(e).__name__}: {e}\n')
        return 1

    if not cookies or 'unb' not in cookies or '_m_h5_tk' not in cookies:
        sys.stderr.write('扫码超时或未确认登录（必需的 cookies 不完整）\n')
        return 2

    out_path = Path(a.cookies_out) if a.cookies_out else (Path.home() / ".goofish-cli" / "cookies.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_cookies_json(out_path, cookies)
    sys.stdout.write(json.dumps({
        'unb': cookies.get('unb', ''),
        'tracknick': cookies.get('tracknick', ''),
        'cookies_count': len(cookies),
    }))
    return 0


if __name__ == '__main__':
    sys.exit(main())
