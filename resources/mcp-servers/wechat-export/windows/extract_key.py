"""Extract Windows WeChat database keys for Lumos.

The script reads local WeChat/Weixin processes from the current Windows user,
starting with the process selected by Lumos and then falling back to helper
processes from the same desktop session. It verifies every candidate key
against the user's own database files before persisting it under
~/.lumos/wechat-export.

Path discovery accepts both legacy WeChat Files/<wxid>/MSG layouts and newer
xwechat_files/<wxid>/db_storage layouts, including when the user selected a
child folder from WeChat's file-management settings.
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
import struct
import sys
import time
import winreg

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
TH32CS_SNAPPROCESS = 0x00000002
TH32CS_SNAPMODULE = 0x00000008
TH32CS_SNAPMODULE32 = 0x00000010
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
MEM_COMMIT = 0x1000
MEM_PRIVATE = 0x20000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
READABLE_PROTECT = 0x02 | 0x04 | 0x08 | 0x20 | 0x40 | 0x80
WRITABLE_PROTECT = 0x04 | 0x08 | 0x40 | 0x80

MAX_PATH = 260
MAX_MODULE_NAME32 = 255
PAGE_SIZE = 4096
KEY_SIZE = 32
SALT_SIZE = 16
V3_RESERVED = 48
V4_RESERVED = 80
MESSAGE_DB_RE = re.compile(r"^(?:MSG|message|media|biz_message)(?:_?\d+)?\.db$", re.I)
HEX_PATTERN = re.compile(rb"[xX]['\"]([0-9a-fA-F]{64,192})")
UTF16_HEX_PATTERN = re.compile(rb"[xX]\x00['\"]\x00((?:[0-9a-fA-F]\x00){64,192})")
KEY_HEX_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
PREFERRED_KEY_MODULE_NAMES = (
    "wechatwin.dll",
    "weixin.dll",
    "wechat.dll",
    "wechatappex.exe",
    "weixinappex.exe",
    "wechatapp.exe",
    "weixinapp.exe",
    "wechat.exe",
    "weixin.exe",
)
KEY_MODULE_PATH_HINTS = ("wechat", "weixin", "tencent")

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


def configure_stdio() -> None:
    """Avoid GBK stdio crashes when Windows paths, nicknames, or messages contain emoji."""
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


class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wt.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wt.DWORD),
        ("Protect", wt.DWORD),
        ("Type", wt.DWORD),
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
VirtualQueryEx = kernel32.VirtualQueryEx
VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MEMORY_BASIC_INFORMATION), ctypes.c_size_t]
VirtualQueryEx.restype = ctypes.c_size_t
CloseHandle = kernel32.CloseHandle
CloseHandle.argtypes = [wt.HANDLE]
CloseHandle.restype = wt.BOOL


def log(message: str) -> None:
    safe_stream_write(sys.stdout, f"{message}\n")


def wechat_process_names() -> set[str]:
    raw = os.environ.get("LUMOS_WECHAT_EXPORT_WINDOWS_PROCESS_NAMES", "")
    names = {part.strip().lower() for part in raw.split(";") if part.strip()}
    names.add("wechat.exe")
    names.add("weixin.exe")
    # Newer Windows WeChat/Weixin builds can keep runtime state in helper
    # processes while the UI detector still reports the main executable PID.
    # Keep the exact main process first in the caller, but let extraction fall
    # through to these helpers when no verified key is found there.
    names.add("wechatappex.exe")
    names.add("weixinappex.exe")
    names.add("wechatapp.exe")
    names.add("weixinapp.exe")
    return names


def list_process_entries() -> list[dict]:
    snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE_VALUE:
        return []
    entry = PROCESSENTRY32()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
    processes: list[dict] = []
    try:
        ok = Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            name = str(entry.szExeFile or "").strip()
            pid = int(entry.th32ProcessID)
            parent_pid = int(entry.th32ParentProcessID)
            if pid > 0 and name:
                processes.append({
                    "pid": pid,
                    "parent_pid": parent_pid,
                    "name": name,
                })
            ok = Process32NextW(snap, ctypes.byref(entry))
    finally:
        CloseHandle(snap)
    return processes


def find_wechat_pids() -> list[int]:
    process_names = wechat_process_names()
    return [
        item["pid"]
        for item in list_process_entries()
        if str(item.get("name") or "").lower() in process_names
    ]


def candidate_wechat_pids(primary_pid: int) -> list[int]:
    """Return process scan order, preferring the real Weixin/WeChat process.

    Windows WeChat 4.x stores the v4 SQLCipher key in Weixin.exe memory, not in
    WeChatAppEx.exe. If Lumos passes an AppEx PID from UI detection, correct the
    order here so the main Weixin process and its children are scanned first.
    """
    process_names = wechat_process_names()
    entries = list_process_entries()
    by_pid = {int(item["pid"]): item for item in entries}
    children_by_parent: dict[int, list[int]] = {}
    for item in entries:
        children_by_parent.setdefault(int(item["parent_pid"]), []).append(int(item["pid"]))

    main_pid_set = {
        int(item["pid"])
        for item in entries
        if str(item.get("name") or "").lower() in {"weixin.exe", "wechat.exe"}
    }
    main_pids = sorted(
        main_pid_set,
        key=lambda pid: (
            int(by_pid.get(pid, {}).get("parent_pid") or 0) in main_pid_set,
            pid,
        ),
    )
    main_child_pids = [
        int(item["pid"])
        for item in entries
        if int(item.get("parent_pid") or 0) in set(main_pids)
        and str(item.get("name") or "").lower() not in {"wechatappex.exe", "weixinappex.exe"}
    ]
    app_helper_pids = [
        int(item["pid"])
        for item in entries
        if str(item.get("name") or "").lower() in process_names
        and str(item.get("name") or "").lower() not in {"wechatappex.exe", "weixinappex.exe"}
        and int(item["pid"]) not in set(main_pids + main_child_pids)
    ]

    ordered: list[int] = []

    def add(pid: int) -> None:
        if pid > 0 and pid not in ordered:
            ordered.append(pid)

    for pid in main_pids + main_child_pids:
        add(pid)
    if primary_pid and primary_pid > 0:
        name = str(by_pid.get(int(primary_pid), {}).get("name") or "").lower()
        if name not in {"wechatappex.exe", "weixinappex.exe"}:
            add(int(primary_pid))
    for pid in app_helper_pids:
        add(pid)
    for parent in list(ordered):
        for child in children_by_parent.get(parent, []):
            name = str(by_pid.get(child, {}).get("name") or "").lower()
            if name not in {"wechatappex.exe", "weixinappex.exe"}:
                add(child)
    return ordered[:64]


def describe_candidate_pids(pids: list[int]) -> str:
    by_pid = {int(item["pid"]): item for item in list_process_entries()}
    labels = []
    for pid in pids:
        item = by_pid.get(int(pid))
        if item:
            labels.append(f"{pid}:{item.get('name')}<ppid={item.get('parent_pid')}>")
        else:
            labels.append(str(pid))
    return ", ".join(labels)


def list_process_modules(pid: int) -> list[tuple[int, int, str, str]]:
    snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
    if snap == INVALID_HANDLE_VALUE:
        log(f"[!] unable to enumerate process modules pid={pid} last_error={ctypes.get_last_error()}")
        return []
    entry = MODULEENTRY32()
    entry.dwSize = ctypes.sizeof(MODULEENTRY32)
    modules: list[tuple[int, int, str, str]] = []
    try:
        ok = Module32FirstW(snap, ctypes.byref(entry))
        while ok:
            name = str(entry.szModule or "").strip()
            path_value = str(entry.szExePath or "").strip()
            base = int(entry.modBaseAddr or 0)
            size = int(entry.modBaseSize)
            if name and base and size:
                modules.append((base, size, path_value, name))
            ok = Module32NextW(snap, ctypes.byref(entry))
    finally:
        CloseHandle(snap)
    return modules


def get_key_scan_modules(pid: int) -> list[tuple[int, int, str, str]]:
    """Return likely modules that may contain legacy WeChat key anchors.

    Older Windows WeChat builds kept the useful anchors in WeChatWin.dll. Newer
    Windows WeChat/Weixin builds may expose different module names, so keep
    scanning exact known names first and then any module whose path clearly
    belongs to WeChat. The SQLCipher string scan below remains the fallback
    when no module is discoverable.
    """
    modules = list_process_modules(pid)
    if not modules:
        return []

    priority = {name: index for index, name in enumerate(PREFERRED_KEY_MODULE_NAMES)}

    def module_rank(module: tuple[int, int, str, str]) -> tuple[int, int]:
        _base, size, module_path, module_name = module
        name = module_name.lower()
        haystack = f"{name} {module_path.lower()}"
        if name in priority:
            return priority[name], -size
        if any(hint in haystack for hint in KEY_MODULE_PATH_HINTS):
            return len(priority), -size
        return len(priority) + 1, -size

    exact = [module for module in modules if module[3].lower() in priority]
    if exact:
        exact.sort(key=module_rank)
        return exact

    hinted = [
        module
        for module in modules
        if any(hint in f"{module[3].lower()} {module[2].lower()}" for hint in KEY_MODULE_PATH_HINTS)
    ]
    hinted.sort(key=module_rank)
    return hinted[:16]


def read_mem(handle: int, address: int, size: int) -> bytes | None:
    if address <= 0 or size <= 0:
        return None
    buf = ctypes.create_string_buffer(size)
    read = ctypes.c_size_t(0)
    ok = ReadProcessMemory(handle, ctypes.c_void_p(address), buf, size, ctypes.byref(read))
    if not ok or read.value <= 0:
        return None
    return bytes(buf.raw[: read.value])


def iter_readable_regions(handle: int) -> list[tuple[int, int]]:
    regions: list[tuple[int, int]] = []
    mbi = MEMORY_BASIC_INFORMATION()
    address = 0
    max_address = 0x7FFFFFFFFFFF if sys.maxsize > 2**32 else 0x7FFFFFFF
    while address < max_address:
        result = VirtualQueryEx(handle, ctypes.c_void_p(address), ctypes.byref(mbi), ctypes.sizeof(mbi))
        if not result:
            address += 0x10000
            continue
        base = int(mbi.BaseAddress or 0)
        size = int(mbi.RegionSize or 0)
        if size <= 0:
            address += 0x1000
            continue
        if (
            mbi.State == MEM_COMMIT
            and (mbi.Protect & PAGE_GUARD) == 0
            and (mbi.Protect & PAGE_NOACCESS) == 0
            and (mbi.Protect & READABLE_PROTECT)
        ):
            if size < 500 * 1024 * 1024:
                regions.append((base, size))
        next_address = base + size
        if next_address <= address:
            address += 0x1000
        else:
            address = next_address
    return regions


# 库首页缓存 + 预解析。
#
# 这是取密钥慢的**真正瓶颈**。_page1 原先每次调用都 open()+read() 一次文件,而它被
# 每个候选 key × 每个库地调用 —— 真机日志里是 55 万候选 × 7 账号 ≈ 385 万次文件 IO。
# 实测纯计算(pbkdf2 迭代 2 + 一次 HMAC-SHA512)只要 ~24 微秒,385 万次也才 91 秒;
# 可 385 万次 open+read 在 Windows(NTFS + 杀毒实时扫描,库还在 D 盘)要十几分钟起步,
# 于是 30 分钟连一半内存区都扫不完。
#
# 首页在扫描期间不会变(salt 和 HMAC 是建库时写死的),读一次即可。顺带把每次都要重算
# 的 mac_salt / hmac_data / stored_hmac 也预解析出来,把每候选的工作量压到最小。
_PAGE1_CACHE: dict[str, bytes | None] = {}
_V4_PAGE1_PARTS: dict[str, tuple[bytes, bytes, bytes] | None] = {}


def _page1(db_path: str) -> bytes | None:
    if db_path in _PAGE1_CACHE:
        return _PAGE1_CACHE[db_path]
    try:
        with open(db_path, "rb") as fh:
            data = fh.read(PAGE_SIZE)
    except OSError:
        data = None
    result = data if data and len(data) >= PAGE_SIZE else None
    _PAGE1_CACHE[db_path] = result
    return result


def _v4_page1_parts(db_path: str) -> tuple[bytes, bytes, bytes] | None:
    """(mac_salt, hmac_data, stored_hmac);首页读不到或结构不对时 None。"""
    if db_path in _V4_PAGE1_PARTS:
        return _V4_PAGE1_PARTS[db_path]
    parts = None
    data = _page1(db_path)
    if data:
        salt = data[:SALT_SIZE]
        first = data[SALT_SIZE:PAGE_SIZE]
        hmac_data = first[:PAGE_SIZE - V4_RESERVED]
        stored_hmac = first[PAGE_SIZE - V4_RESERVED:PAGE_SIZE - SALT_SIZE]
        if len(hmac_data) >= 16 and len(stored_hmac) == 64:
            parts = (bytes(b ^ 0x3A for b in salt), hmac_data, stored_hmac)
    _V4_PAGE1_PARTS[db_path] = parts
    return parts


def _verify_key_v3(key: bytes, db_path: str) -> bool:
    data = _page1(db_path)
    if len(key) != KEY_SIZE or not data:
        return False
    salt = data[:16]
    first = data[16:PAGE_SIZE]
    decrypt_key = hashlib.pbkdf2_hmac("sha1", key, salt, 64000, KEY_SIZE)
    mac_salt = bytes((b ^ 58) for b in salt)
    mac_key = hashlib.pbkdf2_hmac("sha1", decrypt_key, mac_salt, 2, KEY_SIZE)
    digest = hmac.new(mac_key, first[:-32], hashlib.sha1)
    digest.update(b"\x01\x00\x00\x00")
    return hmac.compare_digest(digest.digest(), first[-32:-12])


_PAGE_ONE_SUFFIX = struct.pack("<I", 1)


def _verify_key_v4(key: bytes, db_path: str) -> bool:
    if len(key) != KEY_SIZE:
        return False
    parts = _v4_page1_parts(db_path)
    if not parts:
        return False
    mac_salt, hmac_data, stored_hmac = parts
    mac_key = hashlib.pbkdf2_hmac("sha512", key, mac_salt, 2, KEY_SIZE)
    digest = hmac.new(mac_key, hmac_data, hashlib.sha512)
    digest.update(_PAGE_ONE_SUFFIX)
    return hmac.compare_digest(digest.digest(), stored_hmac)


def verify_key(key: bytes, db_path: str) -> bool:
    return _verify_key_v3(key, db_path) or _verify_key_v4(key, db_path)


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
        return documents_dir()
    return os.path.abspath(value)


def wechat_roots() -> list[str]:
    roots: list[str] = []
    def add_root(root: str | None) -> None:
        if not root:
            return
        roots.append(root)
        base = os.path.basename(root).lower()
        if base not in {"wechat files", "xwechat_files"}:
            roots.append(os.path.join(root, "WeChat Files"))
            roots.append(os.path.join(root, "xwechat_files"))

    manual_roots = os.environ.get("LUMOS_WECHAT_EXPORT_WINDOWS_DATA_ROOTS", "")
    for item in manual_roots.split(os.pathsep):
        root = normalize_wechat_root(item)
        add_root(root)
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Tencent\WeChat")
        value, _ = winreg.QueryValueEx(key, "FileSavePath")
        winreg.CloseKey(key)
        root = normalize_wechat_root(value)
        add_root(root)
    except OSError:
        pass
    appdata = os.environ.get("APPDATA", "")
    ini = os.path.join(appdata, "Tencent", "WeChat", "All Users", "config", "3ebffe94.ini")
    try:
        root = normalize_wechat_root(open(ini, "r", encoding="utf-8").read())
        add_root(root)
    except OSError:
        pass
    add_root(documents_dir())
    return list(dict.fromkeys(roots))


def child_path(parent: str, wanted: str) -> str | None:
    exact = os.path.join(parent, wanted)
    if os.path.exists(exact):
        return exact
    try:
        wanted_lower = wanted.lower()
        for name in os.listdir(parent):
            if name.lower() == wanted_lower:
                return os.path.join(parent, name)
    except OSError:
        pass
    return None


def has_msg_db(directory: str) -> bool:
    try:
        return any(MESSAGE_DB_RE.match(f) for f in os.listdir(directory))
    except OSError:
        return False


def selected_roots(root: str) -> list[str]:
    roots: list[str] = []
    current = os.path.abspath(root)
    for _ in range(8):
        roots.append(current)
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return list(dict.fromkeys(roots))


def account_db_layout(wx_dir: str) -> tuple[str, str, str, str] | None:
    msg_dir = child_path(wx_dir, "MSG") or child_path(wx_dir, "Msg")
    if msg_dir:
        micro = os.path.join(msg_dir, "MicroMsg.db")
        if os.path.isfile(micro):
            if has_msg_db(msg_dir):
                return msg_dir, msg_dir, micro, "v3"
            multi = child_path(msg_dir, "Multi")
            if multi and has_msg_db(multi):
                return msg_dir, multi, micro, "v3"

    db_storage = child_path(wx_dir, "db_storage")
    if db_storage:
        message_dir = child_path(db_storage, "message")
        if message_dir and has_msg_db(message_dir):
            micro = os.path.join(db_storage, "contact", "contact.db")
            return db_storage, message_dir, micro, "v4"
    return None


def account_db_paths(wx_dir: str) -> list[str]:
    layout = account_db_layout(wx_dir)
    if not layout:
        return []
    msg_dir, message_db_dir, micro, mode = layout
    paths: list[str] = []
    if mode == "v4":
        for root, _, files in os.walk(msg_dir):
            for name in files:
                if name.endswith(".db") and not name.endswith(("-wal", "-shm")):
                    paths.append(os.path.join(root, name))
        return list(dict.fromkeys(paths))

    if os.path.isfile(micro):
        paths.append(micro)
    if os.path.isdir(message_db_dir):
        for name in os.listdir(message_db_dir):
            if MESSAGE_DB_RE.match(name):
                paths.append(os.path.join(message_db_dir, name))
    if mode == "v3":
        alt_multi = child_path(msg_dir, "Multi")
        if alt_multi and alt_multi != message_db_dir and os.path.isdir(alt_multi):
            for name in os.listdir(alt_multi):
                if MESSAGE_DB_RE.match(name):
                    paths.append(os.path.join(alt_multi, name))
    return list(dict.fromkeys(paths))


def find_accounts() -> list[dict]:
    accounts: list[dict] = []
    seen: set[str] = set()

    def add_account(wx_dir: str, wxid: str | None = None) -> None:
        if not os.path.isdir(wx_dir):
            return
        layout = account_db_layout(wx_dir)
        if not layout:
            return
        real = os.path.abspath(wx_dir)
        if real in seen:
            return
        seen.add(real)
        msg_dir, message_db_dir, micro, mode = layout
        accounts.append({
            "wxid": wxid or os.path.basename(wx_dir),
            "wx_dir": wx_dir,
            "msg_dir": msg_dir,
            "message_db_dir": message_db_dir,
            "micro_msg": micro,
            "mode": mode,
            "db_paths": account_db_paths(wx_dir),
        })

    def scan_container(root: str) -> None:
        add_account(root)
        try:
            names = os.listdir(root)
        except OSError:
            return
        for name in names:
            if name in {"All Users", "Applet", "WMPF"}:
                continue
            add_account(os.path.join(root, name), name)

    for raw_root in wechat_roots():
        for root in selected_roots(raw_root):
            if not os.path.isdir(root):
                continue
            scan_container(root)
            for nested_name in ("WeChat Files", "xwechat_files"):
                nested = child_path(root, nested_name)
                if nested:
                    scan_container(nested)
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


def db_salt(db_path: str) -> str | None:
    page = _page1(db_path)
    return page[:SALT_SIZE].hex() if page else None


def _record_label(record: dict) -> str:
    return os.path.basename(str(record.get("path") or "unknown.db"))


def verify_db_key(key: bytes, db_path: str, mode: str) -> bool:
    """Mode is detected from the on-disk layout (MSG/ vs db_storage/) but
    that's only a heuristic — a WeChat build could ship a v4 cipher inside
    a 3.x-shaped data directory or vice-versa. If the strict-mode verifier
    fails, fall back to the other algorithm before giving up. Both verifiers
    re-read page 1 of the db and compare HMACs; they're cheap and safe."""
    if mode == "v4":
        return _verify_key_v4(key, db_path) or _verify_key_v3(key, db_path)
    if mode == "v3":
        return _verify_key_v3(key, db_path) or _verify_key_v4(key, db_path)
    return verify_key(key, db_path)


def _hex_from_utf16_match(raw: bytes) -> str:
    return raw.replace(b"\x00", b"").decode("ascii")


def _candidate_pairs_from_hex(hex_str: str) -> list[tuple[str, str | None]]:
    """Return possible (key_hex, salt_hex) pairs from a WCDB-looking hex blob.

    Current Windows WeChat 4.x commonly caches raw SQLCipher keys as
    `x'<64hex_key><32hex_salt>'`, but field order and surrounding bytes have
    varied across builds. Keep the extraction broad and let HMAC verification
    reject false positives.
    """
    pairs: list[tuple[str, str | None]] = []
    normalized = hex_str.lower()

    if len(normalized) >= 96:
        for start in range(0, len(normalized) - 96 + 1):
            chunk = normalized[start:start + 96]
            # key + salt
            pairs.append((chunk[:64], chunk[64:96]))
            # salt + key
            pairs.append((chunk[32:96], chunk[:32]))

    if len(normalized) >= 64:
        pairs.append((normalized[:64], None))
        pairs.append((normalized[-64:], None))

    deduped: list[tuple[str, str | None]] = []
    seen: set[tuple[str, str | None]] = set()
    for key_hex, salt_hex in pairs:
        pair = (key_hex, salt_hex)
        if pair in seen:
            continue
        seen.add(pair)
        deduped.append(pair)
    return deduped


def _ascii_hex_windows_around(block: bytes, center: int, radius: int = 160) -> list[str]:
    start = max(0, center - radius)
    end = min(len(block), center + 32 + radius)
    window = block[start:end]
    chunks = []
    for match in re.finditer(rb"[0-9a-fA-F]{64,128}", window):
        chunks.append(match.group(0).decode("ascii"))
    return chunks


def _raw_key_candidates_around(block: bytes, center: int, radius: int = 96) -> list[bytes]:
    start = max(0, center - radius)
    end = min(len(block), center + SALT_SIZE + radius)
    candidates: list[bytes] = []
    for pos in range(start, max(start, end - KEY_SIZE + 1)):
        candidate = block[pos:pos + KEY_SIZE]
        if len(candidate) != KEY_SIZE:
            continue
        # Skip obviously empty / padded regions; HMAC verification handles the
        # rest but these filters keep the candidate count manageable.
        if candidate == b"\x00" * KEY_SIZE or candidate == b"\xff" * KEY_SIZE:
            continue
        if len(set(candidate)) <= 2:
            continue
        candidates.append(candidate)
    return candidates


def scan_hex_key_strings(handle: int, accounts: list[dict], mark_key, should_stop=None) -> int:
    """Scan readable process memory for cached SQLCipher key material.

    should_stop(): 可选回调,返回 True 时提前收工。这是全内存里最重的一条扫描
    (遍历所有可读区域),必须能在"当前登录账号核心库已集齐"时早退——否则多账号
    (切换过账号)时会为了永远凑不齐的旧账号 salt 扫穿整个堆,拖成"转一上午"(#40)。
    """
    salt_to_records: dict[str, list[dict]] = {}
    for account in accounts:
        for rec in account.get("_db_records") or []:
            salt_to_records.setdefault(rec["salt"], []).append({**rec, "account": account})
    if not salt_to_records:
        return 0

    found = 0
    seen_strings: set[str] = set()
    seen_pairs: set[tuple[str, str | None]] = set()
    seen_raw_keys: set[tuple[str, bytes]] = set()
    regions = iter_readable_regions(handle)
    log(f"[+] scanning memory regions={len(regions)} for SQLCipher key strings")
    chunk_size = 4 * 1024 * 1024
    overlap = 512

    def try_key_for_records(key: bytes, records: list[dict]) -> int:
        added = 0
        key_hex = key.hex()
        for record in records:
            if verify_db_key(key, record["path"], record["mode"]):
                if mark_key(record["account"], record, key_hex):
                    added += 1
        return added

    def try_hex_blob(hex_str: str) -> int:
        if hex_str in seen_strings:
            return 0
        seen_strings.add(hex_str)
        added = 0
        for key_hex, salt_hex in _candidate_pairs_from_hex(hex_str):
            if not KEY_HEX_PATTERN.match(key_hex):
                continue
            pair = (key_hex, salt_hex)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            key = bytes.fromhex(key_hex)
            if salt_hex and salt_hex in salt_to_records:
                records = salt_to_records.get(salt_hex, [])
            elif salt_hex is None:
                records = [record for grouped in salt_to_records.values() for record in grouped]
            else:
                records = []
            if records:
                added += try_key_for_records(key, records)
        return added

    scan_started = time.time()
    for region_index, (base, size) in enumerate(regions, 1):
        if should_stop and should_stop():
            log(f"[+] SQLCipher 扫描早退于 region {region_index}/{len(regions)}(当前账号核心库已集齐)")
            break
        if region_index % 25 == 0:
            log(
                f"[+] SQLCipher 扫描进度 regions={region_index}/{len(regions)} "
                f"found={found} elapsed={int(time.time() - scan_started)}s"
            )
        tail = b""
        offset = 0
        while offset < size:
            if should_stop and should_stop():
                break
            to_read = min(chunk_size, size - offset)
            data = read_mem(handle, base + offset, to_read)
            if not data:
                offset += to_read
                tail = b""
                continue
            block = tail + data
            for match in HEX_PATTERN.finditer(block):
                found += try_hex_blob(match.group(1).decode("ascii"))
            for match in UTF16_HEX_PATTERN.finditer(block):
                found += try_hex_blob(_hex_from_utf16_match(match.group(1)))

            # Some builds keep raw key bytes close to the database salt instead
            # of, or in addition to, the SQL text literal. Search only around
            # exact known salts to avoid brute-forcing arbitrary memory.
            for salt_hex, records in salt_to_records.items():
                salt_bytes = bytes.fromhex(salt_hex)
                start = 0
                while True:
                    idx = block.find(salt_bytes, start)
                    if idx == -1:
                        break
                    for raw_key in _raw_key_candidates_around(block, idx):
                        raw_pair = (salt_hex, raw_key)
                        if raw_pair in seen_raw_keys:
                            continue
                        seen_raw_keys.add(raw_pair)
                        found += try_key_for_records(raw_key, records)
                    start = idx + 1

                salt_ascii = salt_hex.encode("ascii")
                start = 0
                while True:
                    idx = block.find(salt_ascii, start)
                    if idx == -1:
                        break
                    for hex_blob in _ascii_hex_windows_around(block, idx):
                        found += try_hex_blob(hex_blob)
                    start = idx + 1
            tail = block[-overlap:]
            offset += to_read
    log(
        "[+] SQLCipher memory scan "
        f"found={found} unique_strings={len(seen_strings)} "
        f"unique_pairs={len(seen_pairs)} raw_candidates={len(seen_raw_keys)} "
        f"elapsed={int(time.time() - scan_started)}s"
    )
    return found


def iter_writable_private_regions(handle: int, broad: bool = False) -> list[tuple[int, int, int]]:
    """列出待扫描内存区。

    默认(broad=False):私有 + 可写 + 已提交 —— SQLCipher/WCDB 的 key 传统上就挂在
    这类普通堆上,范围小、扫得快。

    broad=True:放宽成**所有已提交可读区**(去掉"私有"和"可写"两条要求,保留非 guard /
    非 noaccess)。微信 4.1 起 found=0,而私有可写区实扫才 7MB —— 强烈怀疑 key 被挪到了
    内存映射区(MEM_MAPPED)或写后转只读的防篡改区,这两类都被默认过滤挡在外面。
    验证已经很便宜(首页缓存),所以兜底全扫一遍来回答"key 到底在不在进程内存里"。
    """
    regions: list[tuple[int, int, int]] = []
    mbi = MEMORY_BASIC_INFORMATION()
    address = 0
    max_address = 0x7FFFFFFFFFFF if sys.maxsize > 2**32 else 0x7FFFFFFF
    # 可读即可(broad 模式):RW / R / WriteCopy / 可执行读 全算上
    READABLE_ANY = 0x02 | 0x04 | 0x08 | 0x20 | 0x40 | 0x80
    while address < max_address:
        result = VirtualQueryEx(handle, ctypes.c_void_p(address), ctypes.byref(mbi), ctypes.sizeof(mbi))
        if not result:
            address += 0x10000
            continue
        base = int(mbi.BaseAddress or 0)
        size = int(mbi.RegionSize or 0)
        protect = int(mbi.Protect)
        common = (
            size > 0
            and mbi.State == MEM_COMMIT
            and (protect & PAGE_GUARD) == 0
            and (protect & PAGE_NOACCESS) == 0
            and size < 500 * 1024 * 1024
        )
        if broad:
            ok = common and bool(protect & READABLE_ANY)
        else:
            ok = (
                common
                and int(mbi.Type) == MEM_PRIVATE
                and bool(protect & WRITABLE_PROTECT)
            )
        if ok:
            regions.append((base, size, protect))
        next_address = base + size
        address = next_address if next_address > address else address + 0x1000
    return regions


def high_entropy_key_candidate(key: bytes) -> bool:
    return len(key) == KEY_SIZE and key.count(0) < 8 and len(set(key)) > 16


def is_core_v4_db(path: str) -> bool:
    name = os.path.basename(path).lower()
    return name in {"contact.db", "session.db"} or name.startswith("message_")


def v4_records_by_account(
    accounts: list[dict],
    only_wxid: str = "",
) -> list[tuple[dict, list[dict]]]:
    """按账号分组待验证的 v4 库。

    only_wxid 非空时**只留这一个账号**。这是取密钥性能的头号杠杆:每个候选 key 都要
    对每个账号的核心库各做一次 PBKDF2(SQLCipher 25.6 万次迭代,故意设计得很慢),
    而已登出账号的 key 根本不在当前进程内存里 —— 验它们必然失败,纯属白烧 CPU。

    真机日志(2026-08-12)里这笔账很吓人:发现 7 个账号(其中 3 个因数据根路径重叠
    而重复),单个内存区就产出 55 万个候选 → 55 万 × 7 账号 × 若干核心库的 PBKDF2,
    30 分钟只扫完 436 个区里的 175 个,一把密钥都没拿到。
    用户要的其实就一句话:「我只管我要登录的那个微信账号」。
    """
    grouped: list[tuple[dict, list[dict]]] = []
    seen_wxid: set[str] = set()
    for account in accounts:
        if account.get("mode") != "v4":
            continue
        wxid = str(account.get("wxid") or "")
        if only_wxid and wxid != only_wxid:
            continue
        # 同一 wxid 去重:find_accounts 按真实路径去重,可同一账号会经由多个重叠的
        # 数据根被发现(D:\xwechat_files 和 D:\xwechat_files\<wxid> 都在候选里),
        # 于是同一账号的 salt 被验两遍 —— 白白翻倍。
        if wxid and wxid in seen_wxid:
            continue
        if wxid:
            seen_wxid.add(wxid)
        records = [rec for rec in account.get("_db_records") or [] if rec.get("mode") == "v4"]
        core = [rec for rec in records if is_core_v4_db(rec.get("path") or "")]
        if core:
            grouped.append((account, core))
        elif records:
            grouped.append((account, records))
    return grouped


def verify_and_mark_v4_key(key: bytes, grouped: list[tuple[dict, list[dict]]], mark_key) -> int:
    added = 0
    key_hex = key.hex()
    for account, records in grouped:
        # 快速否决:这把 key 连该账号任一核心库(contact/session/message_*)都开不了就跳过。
        if not any(_verify_key_v4(key, rec["path"]) for rec in records):
            continue
        # 命中后【逐库各自验证】,只把 key 标到它真能解开的库上。绝不"验过一个核心库就盖给全部 v4 salt"——
        # 部分微信 4.x 账号对 contact / session / message_* 用【不同的 key】,盖全部会把 message/session
        # 标上错的 contact key,后续解密全崩(表现为消息库 0/N)。逐库标也让上层扫描知道还差哪些 key、继续找。
        all_records = [rec for rec in account.get("_db_records") or [] if rec.get("mode") == "v4"]
        for record in all_records:
            if _verify_key_v4(key, record["path"]):
                added += int(bool(mark_key(account, record, key_hex)))
    return added


def scan_v4_raw_heap_keys(handle: int, accounts: list[dict], mark_key, only_wxid: str = "") -> int:
    grouped = v4_records_by_account(accounts, only_wxid)
    if not grouped:
        # 指定的账号没有 v4 库(比如 wxid 填错)时退回全量,总比什么都不扫强。
        grouped = v4_records_by_account(accounts)
    if not grouped:
        return 0
    salt_count = sum(len(recs) for _a, recs in grouped)
    log(
        f"[+] v4 验证范围: 账号数={len(grouped)} 待验库数={salt_count}"
        + (f" (已锁定当前登录账号 {only_wxid})" if only_wxid else " (未指定当前账号,全量验证)")
    )
    # 目标 = 各账号的核心 v4 库 salt(contact/session/message_*),【按账号分组】;逐库验到、
    # 任一账号这组集齐即提前收工。两条铁律:①别"找到第一把 key 就 return"(一个账号不同库
    # 可能用不同 key,早退会漏 message/session);②别要求"所有账号全集齐"——多账号(切换过账号)
    # 时旧账号 key 不在内存、salt 永远凑不齐,会扫遍整个堆 never 早退、拖成"转一上午"(#40)。
    account_salt_groups = [
        {rec["salt"] for rec in records if rec.get("salt")}
        for _account, records in grouped
    ]
    account_salt_groups = [g for g in account_salt_groups if g]
    recovered_salts: set[str] = set()

    def tracking_mark(account: dict, record: dict, key_hex: str) -> bool:
        ok = mark_key(account, record, key_hex)
        salt = record.get("salt")
        if ok and salt:
            recovered_salts.add(salt)
        return ok

    region_candidate_cap = 200000
    total_candidate_budget = 4000000

    def run_pass(regions: list[tuple[int, int, int]], label: str) -> int:
        # 小区优先:SQLCipher 的 key 挂在普通堆上,所在区通常几十 KB~几 MB;大区多是媒体缓存。
        regions = sorted(regions, key=lambda r: r[1])
        log(f"[+] scanning v4 raw heap regions={len(regions)} ({label})")
        pass_started = time.time()
        found = candidates = scanned = failures = 0
        chunk_size = 4 * 1024 * 1024
        for region_index, (base, size, protect) in enumerate(regions, 1):
            offset = 0
            tail = b""
            region_candidates = 0
            skipped_region = False
            while offset < size:
                to_read = min(chunk_size, size - offset)
                data = read_mem(handle, base + offset, to_read)
                if not data:
                    failures += 1
                    offset += to_read
                    tail = b""
                    continue
                block = tail + data
                block_base = base + offset - len(tail)
                for pos in range(0, max(0, len(block) - KEY_SIZE + 1), 8):
                    key = block[pos:pos + KEY_SIZE]
                    if high_entropy_key_candidate(key):
                        region_candidates += 1
                        if region_candidates > region_candidate_cap or candidates >= total_candidate_budget:
                            skipped_region = True
                            break
                        candidates += 1
                        marked = verify_and_mark_v4_key(key, grouped, tracking_mark)
                        if marked:
                            found += marked
                            log(f"[FOUND] v4 raw heap key pid_region=0x{base:x} offset=0x{block_base + pos:x} key=<redacted>")
                            if account_salt_groups and any(g.issubset(recovered_salts) for g in account_salt_groups):
                                log(
                                    f"[+] v4 raw heap 早退:某账号核心库已集齐 "
                                    f"regions_scanned={region_index}/{len(regions)} elapsed={int(time.time() - pass_started)}s"
                                )
                                return found
                scanned += len(data)
                tail = block[-31:]
                offset += to_read
                if skipped_region:
                    break
            if skipped_region:
                reason = ("总候选预算用尽" if candidates >= total_candidate_budget
                          else f"单区候选超过 {region_candidate_cap}")
                log(f"[SKIP] region {region_index}/{len(regions)} ({size // 1048576}MB) {reason},跳过")
                if candidates >= total_candidate_budget:
                    log(f"[!] 已达总候选预算 {total_candidate_budget},停止本轮扫描")
                    break
            if region_index % 25 == 0:
                log(f"[+] v4 heap progress regions={region_index}/{len(regions)} scanned_mb={scanned // 1048576} candidates={candidates} found={found}")
        log(
            f"[+] v4 raw heap scan ({label}) found={found} candidates={candidates} "
            f"scanned_mb={scanned // 1048576} read_failures={failures} elapsed={int(time.time() - pass_started)}s"
        )
        return found

    # 第一轮:私有可写堆(传统 key 存放处,范围小、最快)。
    found = run_pass(iter_writable_private_regions(handle, broad=False), "私有可写堆")
    if found or (account_salt_groups and any(g.issubset(recovered_salts) for g in account_salt_groups)):
        return found

    # 兜底:私有可写区一无所获。微信 4.1 起 key 可能被挪到内存映射区或写后转只读区,
    # 都被第一轮的过滤挡在外面。放宽到所有可读区再扫一遍,回答"key 到底在不在进程内存里"。
    log("[!] 私有可写堆未找到 key,放宽到全部可读内存区兜底扫描(诊断 4.1.x key 是否改了存放位置)")
    return run_pass(iter_writable_private_regions(handle, broad=True), "全可读区兜底")


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
            previous = by_wxid.get(wxid, {})
            keys = {}
            if isinstance(previous.get("keys"), dict):
                keys.update(previous["keys"])
            if isinstance(item.get("keys"), dict):
                keys.update(item["keys"])
            key_sources = {}
            if isinstance(previous.get("key_sources"), dict):
                key_sources.update(previous["key_sources"])
            if isinstance(item.get("key_sources"), dict):
                key_sources.update(item["key_sources"])
            merged = {**previous, **item, "keys": keys}
            if key_sources:
                merged["key_sources"] = key_sources
            if not merged.get("key"):
                merged["key"] = next(iter(keys.values()), "")
            by_wxid[wxid] = merged
    return sorted(by_wxid.values(), key=lambda item: int(item.get("extracted_at") or 0), reverse=True)


def extract(pid: int, accounts_out: str, key_out: str) -> int:
    active_wxid = os.environ.get("LUMOS_WECHAT_EXPORT_WINDOWS_ACTIVE_WXID", "").strip()
    log(
        "[ENV] Lumos 传入: "
        f"active_wxid_hint={active_wxid or '-'} | "
        f"data_roots={os.environ.get('LUMOS_WECHAT_EXPORT_WINDOWS_DATA_ROOTS', '') or '-'}"
    )
    pids = candidate_wechat_pids(pid)
    if not pids:
        raise RuntimeError("未找到运行中的 WeChat.exe / Weixin.exe")
    log(f"[+] candidate pids={describe_candidate_pids(pids)} primary={pid or 'auto'}")

    accounts = find_accounts()
    if not accounts:
        raise RuntimeError("未找到 Windows 微信数据目录")
    log(
        f"[+] find_accounts 发现 {len(accounts)} 个账号: "
        + ", ".join(a.get("wxid", "?") for a in accounts)
        + (f" | 预期当前登录账号={active_wxid}" if active_wxid else "")
    )

    for account in accounts:
        db_records = []
        for db_path in account.get("db_paths") or []:
            salt = db_salt(db_path)
            if salt:
                db_records.append({
                    "path": db_path,
                    "salt": salt,
                    "mode": account.get("mode") or "v3",
                })
        account["_db_records"] = db_records
        active_mark = " (当前登录/预期目标)" if account.get("wxid") == active_wxid else ""
        log(f"[+] account wxid={account['wxid']}{active_mark} dbs={len(db_records)} mode={account.get('mode')}")
        for record in db_records:
            log(
                "[DB] "
                f"wxid={account['wxid']} "
                f"db={_record_label(record)} "
                f"salt={record['salt'][:8]}… "
                f"mode={record['mode']}"
            )

    recovered_by_wxid: dict[str, dict] = {}
    recovered_salts: set[str] = set()
    total_records = sum(len(account.get("_db_records") or []) for account in accounts)
    # 完成判据只看【核心聊天库】(contact / session / message_*)。非核心库(media / emoticon /
    # 业务库等)的 key 未必在进程内存里;若把它们也纳入判据,扫描会永远"没集齐"→ 一路空耗到 hex
    # 全量扫描卡死、never 写盘,连已找到的聊天库 key 也一起丢(现象:找到 7 把却卡一夜、仍 0/3)。
    # 核心库 key 找齐即视为成功、收工写盘;非核心库能顺带找到就找,找不到不阻塞完成。
    # (Windows 微信 4.1.8 实测验证:改后取钥 1-2 分钟完成,message/session 全部解开。)
    # 每个账号的核心库 salt 各成一组;完成判据 = 任一账号这组 salt 全部到手即收工。
    # 多账号(尤其切换过账号)时,已登出账号的 key 不在当前进程内存里、其 salt 永远凑不齐;
    # 若沿用"所有账号所有核心 salt"的老判据会永远没集齐 → 全量 hex 扫描空耗、never 提前收工、
    # 拖到扫完整个堆才写盘(现象:找到当前账号的 key 却转一上午、UI 显示 0/N)。按账号判定
    # 即可在当前登录账号的核心库集齐时立即收工,自然跳过登出账号那些永远凑不齐的 salt。
    def _account_core_salts(account: dict) -> set:
        recs = account.get("_db_records") or []
        core = {
            rec["salt"] for rec in recs
            if rec.get("mode") == "v4" and is_core_v4_db(rec.get("path") or "")
        }
        return core or {rec["salt"] for rec in recs}

    account_salt_groups: list[tuple[str, set]] = []
    for account in accounts:
        group = _account_core_salts(account)
        if group:
            account_salt_groups.append((account["wxid"], group))
    target_salts = set().union(*[g for _w, g in account_salt_groups]) if account_salt_groups else set()
    for wxid, group in account_salt_groups:
        mark = " (当前登录/预期目标)" if wxid == active_wxid else ""
        log(f"[TARGET] account={wxid}{mark} 需集齐核心库 key 数={len(group)}")
    log(
        f"[TARGET] 完成判据=任一账号这组核心库 key 全部到手即收工"
        f"(共 {len(account_salt_groups)} 组);登出账号的 key 不在内存、永远凑不齐,不阻塞完成"
    )

    completion_logged = {"done": False}

    def persist(items: list[dict]) -> None:
        """把已恢复的账号写盘(与既有内容合并)。失败不抛 —— 落盘只是加分项,
        不能因为一次写失败就中断还在进行的扫描。"""
        if not items:
            return
        try:
            os.makedirs(os.path.dirname(accounts_out), exist_ok=True)
            merged = merge_accounts(load_existing_accounts(accounts_out), items)
            tmp = f"{accounts_out}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(merged, fh, ensure_ascii=False, indent=2)
            # 原子替换:半截 JSON 会让下次启动读不出既有 key,反而更糟
            os.replace(tmp, accounts_out)
            first_key = next((i.get("key") for i in items if i.get("key")), "")
            if first_key:
                with open(key_out, "w", encoding="utf-8") as fh:
                    fh.write(first_key)
        except Exception as err:  # noqa: BLE001
            log(f"[WARN] 增量写盘失败(不影响继续扫描): {err}")

    def flush_recovered() -> None:
        persist(sorted(
            recovered_by_wxid.values(),
            key=lambda item: int(item.get("extracted_at") or 0),
            reverse=True,
        ))

    def scan_complete() -> bool:
        for wxid, group in account_salt_groups:
            if group.issubset(recovered_salts):
                if not completion_logged["done"]:
                    completion_logged["done"] = True
                    log(f"[COMPLETE] account={wxid} 核心库已全部集齐({len(group)} 把),收工写盘、停止扫描")
                return True
        return False
    # 参与完成判据的库是否全是 v4。是的话,3.x 的指针锚点/hex 字符串扫描没有意义。
    legacy_scan_useless = bool(account_salt_groups) and all(
        rec.get("mode") == "v4"
        for account in accounts
        for rec in (account.get("_db_records") or [])
    )

    ptr_sizes = [8, 4] if sys.maxsize > 2**32 else [4, 8]
    scan_summaries: list[dict] = []
    total_pointer_keys_seen = 0

    def mark_key(account: dict, record: dict, key_hex: str, source_pid: int, source_module_path: str) -> bool:
        wxid = account["wxid"]
        item = recovered_by_wxid.setdefault(wxid, {
            "wxid": wxid,
            "wx_dir": account["wx_dir"],
            "msg_dir": account.get("msg_dir"),
            "message_db_dir": account.get("message_db_dir"),
            "mode": account.get("mode"),
            "key": "",
            "keys": {},
            "key_sources": {},
            "pid": source_pid,
            "module_path": source_module_path,
            "extracted_at": int(time.time() * 1000),
        })
        salt = record["salt"]
        if salt in item["keys"]:
            return False
        item["keys"][salt] = key_hex
        item.setdefault("key_sources", {})[salt] = {
            "pid": source_pid,
            "module_path": source_module_path,
            "db": _record_label(record),
        }
        recovered_salts.add(salt)
        if not item["key"]:
            item["key"] = key_hex
            item["pid"] = source_pid
            item["module_path"] = source_module_path
        label = _record_label(record)
        if len(item["keys"]) == 1:
            log(f"[FOUND] wxid={wxid} pid={source_pid} db={label} salt={salt[:8]}… key=<redacted>")
        else:
            log(f"[FOUND] wxid={wxid} pid={source_pid} db={label} salt={salt[:8]}… key=<redacted> (extra db)")
        # 找到就立刻落盘。以前只在全部扫完后写一次,于是外层 30 分钟硬超时 SIGKILL
        # 一到,进程直接死在半路 —— 扫了半小时、明明已经找到好几把 key,却一把都没
        # 留下,下次还得从头再来。这正是用户说的"失败率太高了"。
        # 增量写盘让每一把 key 立刻变成既成事实:即便被杀,已找到的也还在,
        # 下次运行 load_existing_accounts + merge_accounts 会自动接上。
        flush_recovered()
        return True

    for index, scan_pid in enumerate(pids, start=1):
        if account_salt_groups and scan_complete():
            break

        modules = get_key_scan_modules(scan_pid)
        module_path = modules[0][2] if modules else ""
        summary = {
            "pid": scan_pid,
            "opened": False,
            "modules": len(modules),
            "pointer_keys": 0,
            "v4_heap_found": 0,
            "hex_found": 0,
            "error": "",
        }
        scan_summaries.append(summary)

        log(f"[+] attaching pid={scan_pid} ({index}/{len(pids)})")
        if modules:
            names = ", ".join(module[3] for module in modules[:8])
            suffix = " ..." if len(modules) > 8 else ""
            log(f"[+] key scan modules={len(modules)} names={names}{suffix}")
        else:
            log("[!] 未找到 WeChatWin.dll/Weixin.dll 等微信模块，将跳过旧版指针扫描并尝试全进程 SQLCipher 字符串扫描")

        handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, scan_pid)
        if not handle:
            last_error = ctypes.get_last_error()
            summary["error"] = f"open_failed:{last_error}"
            log(f"[!] unable to open pid={scan_pid} last_error={last_error}")
            continue

        summary["opened"] = True
        seen_keys: set[bytes] = set()
        try:
            if target_salts and not scan_complete():
                def mark_scanned_key(account: dict, record: dict, key_hex: str) -> bool:
                    return mark_key(account, record, key_hex, scan_pid, module_path)

                summary["v4_heap_found"] = scan_v4_raw_heap_keys(handle, accounts, mark_scanned_key, active_wxid)

            # 目标全是 v4 库时,下面两条 3.x 老路(指针锚点扫描、x'..' hex 字符串扫描)
            # 恒定找不到东西 —— 4.x 的 key 是裸 32 字节存在堆里,既没有 iphone/android
            # 锚点旁的指针,也没有 hex 字面量。但它们很贵:真机日志里 v4 堆扫描 100 秒
            # 就跑完了 449 个区,剩下 28 分钟全耗在这两条上(Weixin.dll 176MB 扫两遍 +
            # 2024 个区找字符串),最后被 30 分钟硬超时砍掉。
            if legacy_scan_useless:
                log("[+] 目标账号均为 v4 库,跳过 3.x 指针/hex 字符串扫描(在 4.x 上恒无结果)")

            if not legacy_scan_useless and modules and target_salts and not scan_complete():
                for ptr_size in ptr_sizes:
                    log(f"[+] scanning candidate pointers ptr_size={ptr_size}")
                    for base, size, module_path_candidate, module_name in modules:
                        log(f"[+] scanning module {module_name} base=0x{base:x} size={size} path={module_path_candidate}")
                        for key in candidate_keys(handle, base, size, ptr_size):
                            if key in seen_keys:
                                continue
                            seen_keys.add(key)
                            key_hex = key.hex()
                            for account in accounts:
                                for record in account.get("_db_records") or []:
                                    salt = record["salt"]
                                    if salt in recovered_salts:
                                        continue
                                    if verify_db_key(key, record["path"], record["mode"]):
                                        mark_key(account, record, key_hex, scan_pid, module_path_candidate)
                            if scan_complete():
                                break
                        if scan_complete():
                            break
                    if scan_complete():
                        break

            if not legacy_scan_useless and target_salts and not scan_complete():
                def mark_scanned_key(account: dict, record: dict, key_hex: str) -> bool:
                    return mark_key(account, record, key_hex, scan_pid, module_path)

                summary["hex_found"] = scan_hex_key_strings(handle, accounts, mark_scanned_key, scan_complete)
        except Exception as err:  # noqa: BLE001
            summary["error"] = str(err)
            log(f"[!] scan pid={scan_pid} failed: {err}")
        finally:
            summary["pointer_keys"] = len(seen_keys)
            total_pointer_keys_seen += len(seen_keys)
            CloseHandle(handle)
            progress = " ".join(
                f"{wxid}={len(group & recovered_salts)}/{len(group)}"
                for wxid, group in account_salt_groups
            )
            log(
                f"[PROGRESS] pid={scan_pid} 阶段结束 "
                f"v4_heap={summary['v4_heap_found']} pointer={summary['pointer_keys']} hex={summary['hex_found']} "
                f"| 各账号已集齐核心库: {progress or '-'}"
            )

    recovered = sorted(recovered_by_wxid.values(), key=lambda item: int(item.get("extracted_at") or 0), reverse=True)
    if not recovered:
        # Dump everything we tried so the failure is diagnosable from a single
        # extraction attempt without another packaging cycle. The API route
        # echoes the last 2 KB of this log back to the UI; user can also
        # forward the full logPath if the tail is truncated.
        log("[DIAG] ===== extraction failed: NO verified keys =====")
        log(
            f"[DIAG] accounts={len(accounts)} "
            f"total_records={total_records} "
            f"candidate_pointer_keys_seen={total_pointer_keys_seen} "
            f"candidate_pids={','.join(str(item) for item in pids)}"
        )
        for item in scan_summaries:
            log(
                "[DIAG] pid "
                f"{item.get('pid')} opened={item.get('opened')} "
                f"modules={item.get('modules')} "
                f"pointer_keys={item.get('pointer_keys')} "
                f"v4_heap_found={item.get('v4_heap_found')} "
                f"hex_found={item.get('hex_found')} "
                f"error={item.get('error') or '-'}"
            )
        for account in accounts:
            recs = account.get("_db_records") or []
            log(
                f"[DIAG] account wxid={account.get('wxid')} "
                f"mode={account.get('mode')} "
                f"dbs={len(recs)}"
            )
            for rec in recs:
                log(
                    f"[DIAG]   db={_record_label(rec)} "
                    f"salt={(rec.get('salt') or '')[:8]}… "
                    f"mode={rec.get('mode')}"
                )
        if not any(item.get("opened") for item in scan_summaries):
            log("[DIAG] no candidate process could be opened for PROCESS_VM_READ")
            raise RuntimeError("无法读取微信进程。请用当前 Windows 用户运行 Lumos，并确认微信已打开。")
        log("[DIAG] possible causes: WeChat build uses non-standard KDF iter / "
            "memory hardening prevents pointer scan / db on disk is older snapshot than memory key. "
            "Forward this log to the Lumos developer to extend the probe.")
        raise RuntimeError("未找到可验证的数据库密钥。请确认 Windows 微信已登录到主界面后重试。")

    for account in accounts:
        missing = [
            record
            for record in account.get("_db_records") or []
            if record.get("salt") not in recovered_salts
        ]
        recovered_count = len(account.get("_db_records") or []) - len(missing)
        log(
            "[SUMMARY] "
            f"wxid={account['wxid']} recovered={recovered_count}/{len(account.get('_db_records') or [])}"
        )
        for record in missing:
            log(
                "[MISSING] "
                f"wxid={account['wxid']} "
                f"db={_record_label(record)} "
                f"salt={record['salt'][:8]}…"
            )

    # 收尾再写一次(扫描中已增量写过,这里保证最终状态完整)。
    persist(recovered)
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
        safe_stream_write(sys.stderr, f"[ERROR] {err}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
