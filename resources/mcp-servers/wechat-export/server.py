"""Platform dispatcher for Lumos WeChat Export MCP."""
from __future__ import annotations

import os
import runpy
import sys


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    platform_dir = "windows" if sys.platform == "win32" else "macos"
    target_dir = os.path.join(base_dir, platform_dir)
    target = os.path.join(target_dir, "server.py")
    if not os.path.exists(target):
        raise SystemExit(f"wechat-export is not available for platform: {sys.platform}")
    sys.path.insert(0, target_dir)
    runpy.run_path(target, run_name="__main__")


if __name__ == "__main__":
    main()
