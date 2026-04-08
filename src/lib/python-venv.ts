import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
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
export async function ensureVenv(): Promise<string> {
  const venvPython = getVenvPythonPath();
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  const python = resolvePythonBinary();
  if (!python) {
    throw new Error('Python runtime not available. Cannot create virtual environment.');
  }

  fs.mkdirSync(VENV_DIR, { recursive: true });
  await execFileAsync(python, ['-m', 'venv', VENV_DIR], { timeout: EXEC_TIMEOUT });

  if (!fs.existsSync(venvPython)) {
    throw new Error(`Failed to create venv at ${VENV_DIR}`);
  }

  // 升级 pip（静默）
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
