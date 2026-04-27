#!/usr/bin/env python3
"""
Extract WeChat 4.x SQLCipher database key from a running WeChat process on macOS.

WCDB caches the key in memory as an ASCII PRAGMA fragment of the form
    x'<64-hex-derived-key><32-hex-salt>'
not as raw bytes adjacent to the salt. So scan for that literal substring,
then verify each candidate via SQLCipher 4's HMAC-SHA512 page authenticator.

Algorithm credit: ylytdeng/wechat-decrypt + Thearas/wechat-db-decrypt-macos (WTFPL).

Usage:
    PYTHONPATH=$(lldb -P) /usr/bin/python3 extract_key.py [--pid PID]

Looks under ~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files
to find encrypted DBs and reads each one's salt to anchor the search.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import hmac as hmac_mod
import json
import os
import re
import struct
import sys
import time
from typing import Iterable

import lldb  # type: ignore  # via PYTHONPATH=$(lldb -P)


PAGE_SZ = 4096
KEY_SZ = 32
SALT_SZ = 16
WECHAT_DB_ROOT = os.path.expanduser(
    "~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"
)

# Regex for literal `x'<hex>'` in memory. SQLCipher format: 64 hex (key) + 32 hex
# (salt) = 96 hex. Some WCDB build flavours append more; cap at 192 to bound work.
HEX_PATTERN = re.compile(rb"x'([0-9a-fA-F]{64,192})'")


def find_db_storage_dir() -> str | None:
    """Locate the user's xwechat_files/<wxid>/db_storage directory."""
    matches = glob.glob(os.path.join(WECHAT_DB_ROOT, "*", "db_storage"))
    if not matches:
        return None
    return matches[0]


def collect_db_pages(db_dir: str) -> list[tuple[str, str, str, bytes]]:
    """Walk db_storage and return [(rel_path, full_path, salt_hex, page1_bytes)]."""
    out = []
    for root, _, files in os.walk(db_dir):
        for f in files:
            if not f.endswith(".db") or f.endswith("-wal") or f.endswith("-shm"):
                continue
            full = os.path.join(root, f)
            try:
                if os.path.getsize(full) < PAGE_SZ:
                    continue
                with open(full, "rb") as fh:
                    page1 = fh.read(PAGE_SZ)
            except OSError:
                continue
            if len(page1) < PAGE_SZ:
                continue
            rel = os.path.relpath(full, db_dir)
            salt_hex = page1[:SALT_SZ].hex()
            out.append((rel, full, salt_hex, page1))
    return out


def verify_key(key_bytes: bytes, page1: bytes) -> bool:
    """Verify SQLCipher 4 page-1 HMAC-SHA512 against this candidate key."""
    if len(key_bytes) != KEY_SZ or len(page1) != PAGE_SZ:
        return False
    salt = page1[:SALT_SZ]
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", key_bytes, mac_salt, 2, dklen=KEY_SZ)
    hmac_data = page1[SALT_SZ : PAGE_SZ - 80 + 16]
    stored_hmac = page1[PAGE_SZ - 64 : PAGE_SZ]
    h = hmac_mod.new(mac_key, hmac_data, hashlib.sha512)
    h.update(struct.pack("<I", 1))  # page number = 1
    return h.digest() == stored_hmac


def attach(pid: int | None) -> tuple[lldb.SBDebugger, lldb.SBProcess]:
    debugger = lldb.SBDebugger.Create()
    debugger.SetAsync(False)
    interp = debugger.GetCommandInterpreter()
    res = lldb.SBCommandReturnObject()
    cmd = f"process attach -p {pid}" if pid else "process attach -n WeChat"
    interp.HandleCommand(cmd, res)
    if not res.Succeeded():
        raise RuntimeError(f"attach failed: {res.GetError() or res.GetOutput()}")
    target = debugger.GetSelectedTarget()
    process = target.GetProcess() if target.IsValid() else lldb.SBProcess()
    if not process.IsValid():
        raise RuntimeError("no valid process after attach")
    return debugger, process


def iter_regions(process: lldb.SBProcess) -> Iterable[tuple[int, int]]:
    region_list = process.GetMemoryRegions()
    for i in range(region_list.GetSize()):
        region = lldb.SBMemoryRegionInfo()
        region_list.GetMemoryRegionAtIndex(i, region)
        if not region.IsReadable() or region.IsExecutable():
            continue
        base = region.GetRegionBase()
        end = region.GetRegionEnd()
        size = end - base
        if 0 < size < 500 * 1024 * 1024:
            yield base, size


def scan(process: lldb.SBProcess, db_pages: list, candidates_path: str) -> dict[str, str]:
    """Return {salt_hex: key_hex} for every db whose key was recovered."""
    salt_to_pages = {salt: page1 for _, _, salt, page1 in db_pages}
    remaining = set(salt_to_pages)
    found: dict[str, str] = {}
    seen_strings: set[str] = set()

    err = lldb.SBError()
    chunk_size = 8 * 1024 * 1024
    total_bytes = 0
    pattern_hits = 0
    region_count = 0

    for base, size in iter_regions(process):
        region_count += 1
        offset = 0
        while offset < size:
            n = min(chunk_size, size - offset)
            data = process.ReadMemory(base + offset, n, err)
            offset += n
            total_bytes += n
            if not err.Success() or not data:
                continue
            for m in HEX_PATTERN.finditer(data):
                hex_str = m.group(1).decode("ascii")
                pattern_hits += 1
                if hex_str in seen_strings:
                    continue
                seen_strings.add(hex_str)
                hex_len = len(hex_str)
                # Try the canonical 96 (key+salt), the trailing 96 (key+salt at end),
                # and the leading 64 (key alone, salt unknown).
                candidate_pairs: list[tuple[str, str | None]] = []
                if hex_len >= 96:
                    candidate_pairs.append((hex_str[:64], hex_str[64:96]))
                    candidate_pairs.append((hex_str[-96:-32], hex_str[-32:]))
                candidate_pairs.append((hex_str[:64], None))

                for key_hex, salt_hex in candidate_pairs:
                    if salt_hex and salt_hex in remaining:
                        page1 = salt_to_pages[salt_hex]
                        if verify_key(bytes.fromhex(key_hex), page1):
                            found[salt_hex] = key_hex
                            remaining.discard(salt_hex)
                            print(f"  [FOUND] salt={salt_hex} key={key_hex}", flush=True)
                    elif salt_hex is None:
                        # Try this raw key against every still-pending db.
                        kb = bytes.fromhex(key_hex)
                        for s in list(remaining):
                            if verify_key(kb, salt_to_pages[s]):
                                found[s] = key_hex
                                remaining.discard(s)
                                print(f"  [FOUND] salt={s} key={key_hex} (key-only match)", flush=True)
                if not remaining:
                    break
            if not remaining:
                break
        if not remaining:
            break

    with open(candidates_path, "w") as fh:
        for s in sorted(seen_strings):
            fh.write(s + "\n")

    print(
        f"  scanned {region_count} regions, {total_bytes / 1024 / 1024:.1f} MB, "
        f"{pattern_hits} hex-string hits, {len(seen_strings)} unique strings → "
        f"{candidates_path}",
        flush=True,
    )
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, default=None,
                        help="WeChat main PID (defaults to attaching by name)")
    parser.add_argument("--out", default="wechat_keys.json",
                        help="Output JSON: {salt_hex: key_hex}")
    parser.add_argument("--key-out", default="key.txt",
                        help="Convenience: write the message_*.db key to this file")
    args = parser.parse_args()

    db_dir = find_db_storage_dir()
    if not db_dir:
        print(f"[-] no xwechat_files/*/db_storage under {WECHAT_DB_ROOT}", file=sys.stderr)
        return 2
    db_pages = collect_db_pages(db_dir)
    if not db_pages:
        print(f"[-] no encrypted databases found in {db_dir}", file=sys.stderr)
        return 2

    salts: dict[str, list[str]] = {}
    for rel, _, salt, _ in db_pages:
        salts.setdefault(salt, []).append(rel)
    print(f"[*] db_storage: {db_dir}")
    print(f"[*] {len(db_pages)} encrypted dbs, {len(salts)} unique salts")
    for s, rels in sorted(salts.items()):
        print(f"    salt {s}: {', '.join(rels[:3])}{' …' if len(rels) > 3 else ''}")

    print("[*] attaching to WeChat ...", flush=True)
    t0 = time.time()
    debugger, process = attach(args.pid)
    try:
        print(f"[+] attached pid={process.GetProcessID()}, scanning memory ...", flush=True)
        found = scan(process, db_pages, candidates_path="candidates.txt")
    finally:
        process.Detach()
        lldb.SBDebugger.Destroy(debugger)
    elapsed = time.time() - t0

    if not found:
        print(f"[-] no keys recovered (elapsed {elapsed:.1f}s)", file=sys.stderr)
        return 1

    with open(args.out, "w") as fh:
        json.dump(found, fh, indent=2)
    print(f"[+] wrote {len(found)} key(s) → {args.out}  (elapsed {elapsed:.1f}s)")

    # Pick the key for any message_*.db so the MCP server can immediately use it.
    msg_salts = {salt for rel, _, salt, _ in db_pages
                 if rel.startswith("message/message_")}
    msg_key = next((found[s] for s in msg_salts if s in found), None)
    if msg_key:
        with open(args.key_out, "w") as fh:
            fh.write(msg_key + "\n")
        print(f"[+] message_*.db key → {args.key_out}: {msg_key}")
    else:
        print("[!] no message_*.db key recovered — check candidates.txt", file=sys.stderr)

    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
