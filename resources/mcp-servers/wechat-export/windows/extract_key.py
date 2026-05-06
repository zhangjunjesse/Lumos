"""Extract Windows WeChat database keys for Lumos.

The script only reads the local WeChat.exe process selected by the user in
Lumos. It verifies every candidate key against the user's own MicroMsg.db before
persisting it under ~/.lumos/wechat-export.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import hashlib
import hmac
import json
import os
import re
import sys
import time
import winreg

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
TH32CS_SNAPPROCESS = 0x00000002
TH32CS_SNAPMODULE = 0x00000008
TH32CS_SNAPMODULE32 = 0x00000010
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

MAX_PATH = 260
MAX_MODULE_NAME32 = 255

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", wt.DWORD),
        ("cntUsage", wt.DWORD),
        ("th32ProcessID", wt.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wt.DWORD),
        ("cntThreads", wt.DWORD),
        ("th32ParentProcessID", wt.DWORD),
        ("pcPriClassBase", wt.LONG),
        ("dwFlags", wt.DWORD),
        ("szExeFile", wt.WCHAR * MAX_PATH),
    ]


class MODULEENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", wt.DWORD),
        ("th32ModuleID", wt.DWORD),
        ("th32ProcessID", wt.DWORD),
        ("GlblcntUsage", wt.DWORD),
        ("ProccntUsage", wt.DWORD),
        ("modBaseAddr", ctypes.c_void_p),
        ("modBaseSize", wt.DWORD),
        ("hModule", ctypes.c_void_p),
        ("szModule", wt.WCHAR * (MAX_MODULE_NAME32 + 1)),
        ("szExePath", wt.WCHAR * MAX_PATH),
    ]


CreateToolhelp32Snapshot = kernel32.CreateToolhelp32Snapshot
CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
CreateToolhelp32Snapshot.restype = wt.HANDLE
Process32FirstW = kernel32.Process32FirstW
Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32)]
Process32FirstW.restype = wt.BOOL
Process32NextW = kernel32.Process32NextW
Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32)]
Process32NextW.restype = wt.BOOL
Module32FirstW = kernel32.Module32FirstW
Module32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(MODULEENTRY32)]
Module32FirstW.restype = wt.BOOL
Module32NextW = kernel32.Module32NextW
Module32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(MODULEENTRY32)]
Module32NextW.restype = wt.BOOL
OpenProcess = kernel32.OpenProcess
OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
OpenProcess.restype = wt.HANDLE
ReadProcessMemory = kernel32.ReadProcessMemory
ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
ReadProcessMemory.restype = wt.BOOL
CloseHandle = kernel32.CloseHandle
CloseHandle.argtypes = [wt.HANDLE]
CloseHandle.restype = wt.BOOL


def log(message: str) -> None:
    print(message, flush=True)


def wechat_process_names() -> set[str]:
    raw = os.environ.get("LUMOS_WECHAT_EXPORT_WINDOWS_PROCESS_NAMES", "")
    names = {part.strip().lower() for part in raw.split(";") if part.strip()}
    names.add("wechat.exe")
    names.add("weixin.exe")
    return names


def find_wechat_pids() -> list[int]:
    process_names = wechat_process_names()
    snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE_VALUE:
        return []
    entry = PROCESSENTRY32()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
    pids: list[int] = []
    try:
        ok = Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            if entry.szExeFile.lower() in process_names:
                pids.append(int(entry.th32ProcessID))
            ok = Process32NextW(snap, ctypes.byref(entry))
    finally:
        CloseHandle(snap)
    return pids


def get_wechatwin_module(pid: int) -> tuple[int, int, str] | None:
    snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
    if snap == INVALID_HANDLE_VALUE:
        return None
    entry = MODULEENTRY32()
    entry.dwSize = ctypes.sizeof(MODULEENTRY32)
    try:
        ok = Module32FirstW(snap, ctypes.byref(entry))
        while ok:
            if entry.szModule.lower() == "wechatwin.dll":
                return int(entry.modBaseAddr or 0), int(entry.modBaseSize), entry.szExePath
            ok = Module32NextW(snap, ctypes.byref(entry))
    finally:
        CloseHandle(snap)
    return None


def read_mem(handle: int, address: int, size: int) -> bytes | None:
    if address <= 0 or size <= 0:
        return None
    buf = ctypes.create_string_buffer(size)
    read = ctypes.c_size_t(0)
    ok = ReadProcessMemory(handle, ctypes.c_void_p(address), buf, size, ctypes.byref(read))
    if not ok or read.value <= 0:
        return None
    return bytes(buf.raw[: read.value])


def verify_key(key: bytes, db_path: str) -> bool:
    try:
        with open(db_path, "rb") as fh:
            data = fh.read(5000)
    except OSError:
        return False
    if len(key) != 32 or len(data) < 4096:
        return False
    salt = data[:16]
    first = data[16:4096]
    decrypt_key = hashlib.pbkdf2_hmac("sha1", key, salt, 64000, 32)
    mac_salt = bytes((b ^ 58) for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha1", decrypt_key, mac_salt, 2, 32)
    digest = hmac.new(mac_key, first[:-32], hashlib.sha1)
    digest.update(b"\x01\x00\x00\x00")
    return hmac.compare_digest(digest.digest(), first[-32:-12])


def expand_env(value: str) -> str:
    return re.sub(r"%([^%]+)%", lambda m: os.environ.get(m.group(1), ""), value)


def documents_dir() -> str:
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        )
        value, _ = winreg.QueryValueEx(key, "Personal")
        winreg.CloseKey(key)
        return expand_env(value)
    except OSError:
        return os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Documents")


def normalize_wechat_root(value: str) -> str | None:
    value = expand_env((value or "").strip())
    if not value:
        return None
    if value == "MyDocument:":
        return os.path.join(documents_dir(), "WeChat Files")
    if os.path.basename(value).lower() == "wechat files":
        return value
    return os.path.join(value, "WeChat Files")


def wechat_roots() -> list[str]:
    roots: list[str] = []
    manual_roots = os.environ.get("LUMOS_WECHAT_EXPORT_WINDOWS_DATA_ROOTS", "")
    for item in manual_roots.split(os.pathsep):
        root = normalize_wechat_root(item)
        if root:
            roots.append(root)
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Tencent\WeChat")
        value, _ = winreg.QueryValueEx(key, "FileSavePath")
        winreg.CloseKey(key)
        root = normalize_wechat_root(value)
        if root:
            roots.append(root)
    except OSError:
        pass
    appdata = os.environ.get("APPDATA", "")
    ini = os.path.join(appdata, "Tencent", "WeChat", "All Users", "config", "3ebffe94.ini")
    try:
        root = normalize_wechat_root(open(ini, "r", encoding="utf-8").read())
        if root:
            roots.append(root)
    except OSError:
        pass
    roots.append(os.path.join(documents_dir(), "WeChat Files"))
    return list(dict.fromkeys(roots))


def find_accounts() -> list[dict]:
    accounts: list[dict] = []
    for root in wechat_roots():
        if not os.path.isdir(root):
            continue
        for name in os.listdir(root):
            if name in {"All Users", "Applet", "WMPF"}:
                continue
            wx_dir = os.path.join(root, name)
            msg_dir = os.path.join(wx_dir, "MSG")
            micro = os.path.join(msg_dir, "MicroMsg.db")
            if os.path.isfile(micro) and any(re.match(r"MSG\d*\.db$", f, re.I) for f in os.listdir(msg_dir)):
                accounts.append({"wxid": name, "wx_dir": wx_dir, "micro_msg": micro})
    return accounts


def candidate_keys(handle: int, base: int, size: int, ptr_size: int) -> list[bytes]:
    anchors = [b"iphone\x00", b"android\x00", b"ipad\x00"]
    found: list[bytes] = []
    seen: set[bytes] = set()
    chunk_size = 1024 * 1024
    overlap = 64
    tail = b""
    offset = 0
    while offset < size:
        to_read = min(chunk_size, size - offset)
        data = read_mem(handle, base + offset, to_read)
        if not data:
            offset += to_read
            tail = b""
            continue
        block = tail + data
        block_base = base + offset - len(tail)
        anchor_addrs: list[int] = []
        for anchor in anchors:
            start = 0
            while True:
                idx = block.find(anchor, start)
                if idx == -1:
                    break
                anchor_addrs.append(block_base + idx)
                start = idx + 1
        for anchor_addr in sorted(set(anchor_addrs), reverse=True):
            # WeChat builds have not kept the nearby key pointer on one stable
            # alignment. Scan byte-by-byte around the anchor and let db
            # verification reject false positives.
            for addr in range(anchor_addr, max(anchor_addr - 2000, base), -1):
                ptr_raw = read_mem(handle, addr, ptr_size)
                if not ptr_raw or len(ptr_raw) != ptr_size:
                    continue
                key_addr = int.from_bytes(ptr_raw, "little")
                if key_addr < 0x10000:
                    continue
                key = read_mem(handle, key_addr, 32)
                if key and len(key) == 32 and key not in seen:
                    seen.add(key)
                    found.append(key)
        tail = block[-overlap:]
        offset += to_read
    return found


def load_existing_accounts(accounts_out: str) -> list[dict]:
    try:
        with open(accounts_out, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            return []
        result = []
        for item in data:
            if isinstance(item, dict) and re.fullmatch(r"[0-9a-fA-F]{64}", str(item.get("key") or "")):
                result.append(item)
        return result
    except (OSError, json.JSONDecodeError):
        return []


def merge_accounts(existing: list[dict], recovered: list[dict]) -> list[dict]:
    by_wxid: dict[str, dict] = {}
    for item in existing:
        wxid = str(item.get("wxid") or "")
        if wxid:
            by_wxid[wxid] = item
    for item in recovered:
        wxid = str(item.get("wxid") or "")
        if wxid:
            by_wxid[wxid] = item
    return sorted(by_wxid.values(), key=lambda item: int(item.get("extracted_at") or 0), reverse=True)


def extract(pid: int, accounts_out: str, key_out: str) -> int:
    if not pid:
        pids = find_wechat_pids()
        pid = pids[0] if pids else 0
    if not pid:
        raise RuntimeError("未找到运行中的 WeChat.exe / Weixin.exe")

    accounts = find_accounts()
    if not accounts:
        raise RuntimeError("未找到 Windows 微信数据目录")

    module = get_wechatwin_module(pid)
    if not module:
        raise RuntimeError("未找到 WeChatWin.dll")
    base, size, module_path = module
    ptr_sizes = [8, 4] if sys.maxsize > 2**32 else [4, 8]
    log(f"[+] attaching pid={pid}")
    log(f"[+] scanning WeChatWin.dll base=0x{base:x} size={size} path={module_path}")

    handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        raise RuntimeError("无法读取微信进程。请用当前 Windows 用户运行 Lumos，并确认微信已打开。")

    recovered: list[dict] = []
    try:
        seen_keys: set[bytes] = set()
        for ptr_size in ptr_sizes:
            log(f"[+] scanning candidate pointers ptr_size={ptr_size}")
            for key in candidate_keys(handle, base, size, ptr_size):
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                key_hex = key.hex()
                for account in accounts:
                    if any(item["wxid"] == account["wxid"] for item in recovered):
                        continue
                    if verify_key(key, account["micro_msg"]):
                        item = {
                            "wxid": account["wxid"],
                            "wx_dir": account["wx_dir"],
                            "key": key_hex,
                            "pid": pid,
                            "module_path": module_path,
                            "extracted_at": int(time.time() * 1000),
                        }
                        recovered.append(item)
                        log(f"[FOUND] wxid={account['wxid']} key=<redacted>")
                if len(recovered) == len(accounts):
                    break
            if len(recovered) == len(accounts):
                break
    finally:
        CloseHandle(handle)

    if not recovered:
        raise RuntimeError("未找到可验证的数据库密钥。请确认 Windows 微信已登录到主界面后重试。")

    os.makedirs(os.path.dirname(accounts_out), exist_ok=True)
    merged = merge_accounts(load_existing_accounts(accounts_out), recovered)
    with open(accounts_out, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False, indent=2)
    with open(key_out, "w", encoding="utf-8") as fh:
        fh.write(recovered[0]["key"])
    log(f"[+] wrote {accounts_out}")
    return len(recovered)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, default=0)
    parser.add_argument("--accounts-out", required=True)
    parser.add_argument("--key-out", required=True)
    args = parser.parse_args()
    try:
        count = extract(args.pid, args.accounts_out, args.key_out)
        log(f"[+] done keys={count}")
        return 0
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {err}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
