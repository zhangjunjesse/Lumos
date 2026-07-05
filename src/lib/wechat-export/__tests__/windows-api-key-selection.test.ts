import { spawnSync } from 'child_process';
import path from 'path';

const PYTHON = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const API_PATH = path.resolve(process.cwd(), 'resources/mcp-servers/wechat-export/windows/api.py');

function canRunPython(): boolean {
  const result = spawnSync(PYTHON, ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function runPython(source: string) {
  return spawnSync(PYTHON, ['-c', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8:backslashreplace',
      PYTHONUTF8: '1',
    },
  });
}

const describeWithPython = canRunPython() ? describe : describe.skip;

describeWithPython('Windows WeChat api.py key selection', () => {
  it('falls back when a stored salt-specific key no longer matches the db', () => {
    const result = runPython(`
import importlib.util
import pathlib
import tempfile

api_path = pathlib.Path(${JSON.stringify(API_PATH)})
spec = importlib.util.spec_from_file_location("wechat_windows_api", api_path)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

salt = "00112233445566778899aabbccddeeff"
stale_key = "aa" * 32
valid_key = "bb" * 32

with tempfile.TemporaryDirectory() as tmp:
    db_path = pathlib.Path(tmp) / "message_0.db"
    db_path.write_bytes(bytes.fromhex(salt) + b"x" * 5000)

    def fake_cipher_mode(key_bytes, db_path_value):
        if key_bytes.hex() == valid_key:
            return "v4"
        raise RuntimeError("数据库密钥不匹配: message_0.db")

    api._cipher_mode = fake_cipher_mode
    account = {
        "wxid": "wxid_test",
        "wx_dir": tmp,
        "key": valid_key,
        "keys": {salt: stale_key},
    }
    assert api._key_for_db_from_account(account, str(db_path)) == valid_key
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('uses different decrypt cache paths for different keys', () => {
    const result = runPython(`
import hashlib
import importlib.util
import pathlib
import tempfile

api_path = pathlib.Path(${JSON.stringify(API_PATH)})
spec = importlib.util.spec_from_file_location("wechat_windows_api", api_path)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

key_a = "11" * 32
key_b = "22" * 32

with tempfile.TemporaryDirectory() as tmp:
    api.DECRYPT_DIR = str(pathlib.Path(tmp) / "cache")
    db_path = pathlib.Path(tmp) / "message_0.db"
    db_path.write_bytes(b"x" * 4096)
    account = {"wxid": "wxid_test", "wx_dir": tmp}

    path_a = api._cache_path(account, str(db_path), key_a)
    path_b = api._cache_path(account, str(db_path), key_b)

    assert path_a != path_b
    assert hashlib.sha256(key_a.encode("ascii")).hexdigest()[:12] in path_a
    assert hashlib.sha256(key_b.encode("ascii")).hexdigest()[:12] in path_b
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('reports session db readability in diagnostics', () => {
    const result = runPython(`
import importlib.util
import pathlib

api_path = pathlib.Path(${JSON.stringify(API_PATH)})
spec = importlib.util.spec_from_file_location("wechat_windows_api", api_path)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

api._encrypted_session_db = lambda: "C:/wechat/session.db"
api._connect = lambda db_path: (_ for _ in ()).throw(RuntimeError("数据库密钥不匹配: session.db"))
api._message_db_status = lambda: []

diag = api._message_db_diagnostics()
assert diag["session_db_readable"] is False
assert "session.db" in diag["session_db_error"]
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
