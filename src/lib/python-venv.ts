import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { dataDir } from './db/connection';
import { resolvePythonBinary } from './python-runtime';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';
const VENV_DIR = path.join(dataDir, 'python-venv');
const EXEC_TIMEOUT = 120_000;

/**
 * venv 内的 python 路径。
 */
export function getVenvPythonPath(): string {
  return isWindows
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python3');
}

/**
 * venv 内的 pip 路径。
 */
function getVenvPipPath(): string {
  return isWindows
    ? path.join(VENV_DIR, 'Scripts', 'pip.exe')
    : path.join(VENV_DIR, 'bin', 'pip');
}

/**
 * venv 是否已创建。
 */
export function isVenvReady(): boolean {
  return fs.existsSync(getVenvPythonPath());
}

/**
 * 返回 venv 目录。
 */
export function getVenvDir(): string {
  return VENV_DIR;
}

/**
 * 确保 venv 存在。首次调用时自动创建。
 * 返回 venv 内的 python 路径。
 */
// mcp / wechat-export 等关键依赖要求 Python ≥ 3.10。早期老 venv 是用系统
// Python 3.9 创建的,会被 mcp[cli] 拒绝(没有兼容 wheel)。低于这个最低版本
// 直接删了重建。
const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 10;
const MIN_PYTHON_VERSION = { major: MIN_PYTHON_MAJOR, minor: MIN_PYTHON_MINOR } as const;

function venvPythonMeetsMinVersion(venvPython: string): boolean {
  try {
    const out = execFileSyncSafe(venvPython, ['--version']);
    if (!out) return false;
    const m = out.match(/Python\s+(\d+)\.(\d+)/);
    if (!m) return false;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major > MIN_PYTHON_MAJOR) return true;
    if (major === MIN_PYTHON_MAJOR && minor >= MIN_PYTHON_MINOR) return true;
    return false;
  } catch {
    return false;
  }
}

function execFileSyncSafe(bin: string, args: string[]): string | null {
  try {
    return execFileSync(bin, args, { stdio: 'pipe', timeout: 3_000 }).toString().trim();
  } catch {
    return null;
  }
}

function bundledPythonHintPath(): string {
  const pythonRelPath = isWindows ? 'python/python.exe' : 'python/bin/python3';
  return `resources/python-runtime/${process.platform}/${process.arch}/${pythonRelPath}`;
}

export async function ensureVenv(): Promise<string> {
  const venvPython = getVenvPythonPath();
  // 已存在的 venv:Python 版本足够就直接复用,不够就删了重建
  // (老用户可能停留在 3.9,导致 mcp 等新包装不上)。
  if (fs.existsSync(venvPython)) {
    if (venvPythonMeetsMinVersion(venvPython)) {
      return venvPython;
    }
    console.warn(`[python-venv] existing venv Python < ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}, rebuilding at ${VENV_DIR}`);
  }

  if (fs.existsSync(VENV_DIR)) {
    fs.rmSync(VENV_DIR, { recursive: true, force: true });
  }

  const python = resolvePythonBinary({ minimumVersion: MIN_PYTHON_VERSION });
  if (!python) {
    throw new Error(
      `Python runtime >= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} not available. ` +
      `Install the bundled runtime or put Python >= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} on PATH. ` +
      `Expected bundled runtime at ${bundledPythonHintPath()}.`,
    );
  }

  fs.mkdirSync(VENV_DIR, { recursive: true });
  await execFileAsync(python, ['-m', 'venv', VENV_DIR], { timeout: EXEC_TIMEOUT });

  if (!fs.existsSync(venvPython)) {
    throw new Error(`Failed to create venv at ${VENV_DIR}`);
  }

  // 创建后再校验一次:bundled python ≥ 3.12,但万一回退到系统 3.9 也得拒掉
  // 避免装 mcp 时再次失败。
  if (!venvPythonMeetsMinVersion(venvPython)) {
    fs.rmSync(VENV_DIR, { recursive: true, force: true });
    throw new Error(
      `Created venv with unsupported Python version (need >= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}). ` +
      `Check ${bundledPythonHintPath()} exists, or put Python >= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR} on PATH.`,
    );
  }

  try {
    await execFileAsync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet'], {
      timeout: EXEC_TIMEOUT,
    });
  } catch {
    // pip 升级失败不阻塞
  }

  return venvPython;
}

/**
 * 在 venv 中安装 pip 包。
 * 自动 ensureVenv。
 */
export async function installPackage(packageName: string): Promise<{ stdout: string; stderr: string }> {
  await ensureVenv();
  const pip = getVenvPipPath();
  return execFileAsync(pip, ['install', packageName], { timeout: EXEC_TIMEOUT });
}

/**
 * 在 venv 中卸载 pip 包。
 */
export async function uninstallPackage(packageName: string): Promise<{ stdout: string; stderr: string }> {
  if (!isVenvReady()) {
    throw new Error('Python venv is not initialized');
  }
  const pip = getVenvPipPath();
  return execFileAsync(pip, ['uninstall', '-y', packageName], { timeout: EXEC_TIMEOUT });
}

/**
 * 列出 venv 中已安装的包，返回 "name==version" 格式。
 */
export async function listPackages(): Promise<string[]> {
  if (!isVenvReady()) return [];
  const pip = getVenvPipPath();

  try {
    const { stdout } = await execFileAsync(pip, ['list', '--format=freeze'], { timeout: 10_000 });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 在 venv 中执行 python 脚本，返回 stdout。
 */
export async function runScript(
  scriptPath: string,
  args: string[] = [],
  options: { timeout?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const venvPython = await ensureVenv();
  return execFileAsync(venvPython, [scriptPath, ...args], {
    timeout: options.timeout ?? EXEC_TIMEOUT,
    cwd: options.cwd,
  });
}
