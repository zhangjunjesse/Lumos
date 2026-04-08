import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const isWindows = process.platform === 'win32';

/**
 * python-build-standalone 解压后的相对路径。
 * install_only 包解压出 python/ 目录。
 */
function getBundledPythonDir(): string {
  const resourcesPath = process.resourcesPath || path.resolve('resources');
  return path.join(resourcesPath, 'python-runtime', process.platform, process.arch, 'python');
}

function getBundledPythonBin(): string {
  const pythonDir = getBundledPythonDir();
  if (isWindows) {
    return path.join(pythonDir, 'python.exe');
  }
  return path.join(pythonDir, 'bin', 'python3');
}

function isExecutable(binPath: string): boolean {
  try {
    execFileSync(binPath, ['--version'], { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析 Python 二进制路径。
 * 优先级：内置 → 系统。
 * 返回 null 表示找不到可用的 Python。
 */
export function resolvePythonBinary(): string | null {
  // 1. 内置 Python
  const bundled = getBundledPythonBin();
  if (fs.existsSync(bundled) && isExecutable(bundled)) {
    return bundled;
  }

  // 2. 系统 Python fallback
  const systemCandidates = isWindows
    ? ['python3.exe', 'python.exe']
    : ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3'];

  for (const candidate of systemCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 获取 Python 版本字符串，例如 "Python 3.12.8"。
 */
export function getPythonVersion(pythonPath: string): string | null {
  try {
    return execFileSync(pythonPath, ['--version'], {
      stdio: 'pipe',
      timeout: 3000,
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * 检查内置 Python 是否可用。
 */
export function isBundledPythonAvailable(): boolean {
  const bundled = getBundledPythonBin();
  return fs.existsSync(bundled);
}

/**
 * 返回内置 Python 的安装目录（用于 PYTHONHOME 等）。
 */
export function getBundledPythonHome(): string | null {
  const dir = getBundledPythonDir();
  return fs.existsSync(dir) ? dir : null;
}
