import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveRuntimeResourcePath } from './runtime-resources';

const isWindows = process.platform === 'win32';

export interface PythonMinimumVersion {
  major: number;
  minor: number;
}

export interface ResolvePythonBinaryOptions {
  minimumVersion?: PythonMinimumVersion;
}

/**
 * python-build-standalone 解压后的相对路径。
 * install_only 包解压出 python/ 目录。
 */
function getBundledPythonDir(): string | null {
  return resolveRuntimeResourcePath(
    path.join('python-runtime', process.platform, process.arch, 'python'),
  );
}

function getBundledPythonBin(): string | null {
  const pythonDir = getBundledPythonDir();
  if (!pythonDir) return null;
  if (isWindows) {
    return path.join(pythonDir, 'python.exe');
  }
  return path.join(pythonDir, 'bin', 'python3');
}

function getPythonVersionOutput(binPath: string): string | null {
  try {
    return execFileSync(binPath, ['--version'], {
      stdio: 'pipe',
      timeout: 3000,
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

function parsePythonVersion(version: string | null): { major: number; minor: number } | null {
  if (!version) return null;
  const match = version.match(/Python\s+(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function meetsMinimumVersion(version: string | null, minimumVersion?: PythonMinimumVersion): boolean {
  if (!minimumVersion) return true;
  const parsed = parsePythonVersion(version);
  if (!parsed) return false;
  if (parsed.major > minimumVersion.major) return true;
  return parsed.major === minimumVersion.major && parsed.minor >= minimumVersion.minor;
}

function isUsablePython(binPath: string, minimumVersion?: PythonMinimumVersion): boolean {
  const version = getPythonVersionOutput(binPath);
  return Boolean(version && meetsMinimumVersion(version, minimumVersion));
}

function systemPythonCandidates(): string[] {
  const candidates = isWindows
    ? ['python3.exe', 'python.exe']
    : [
        'python3.14',
        'python3.13',
        'python3.12',
        'python3.11',
        'python3.10',
        'python3',
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3',
      ];

  return Array.from(new Set(candidates));
}

/**
 * 解析 Python 二进制路径。
 * 优先级：内置 → PATH/系统。
 * 返回 null 表示找不到可用的 Python。
 */
export function resolvePythonBinary(options: ResolvePythonBinaryOptions = {}): string | null {
  // 1. 内置 Python
  const bundled = getBundledPythonBin();
  if (bundled && fs.existsSync(bundled) && isUsablePython(bundled, options.minimumVersion)) {
    return bundled;
  }

  // 2. PATH / 系统 Python fallback。开发态常见新版 Python 来自 conda/pyenv,
  // 只检查 /usr/bin/python3 会落到 macOS 自带 3.9。
  for (const candidate of systemPythonCandidates()) {
    if (isUsablePython(candidate, options.minimumVersion)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 获取 Python 版本字符串，例如 "Python 3.12.8"。
 */
export function getPythonVersion(pythonPath: string): string | null {
  return getPythonVersionOutput(pythonPath);
}

/**
 * 检查内置 Python 是否可用。
 */
export function isBundledPythonAvailable(): boolean {
  const bundled = getBundledPythonBin();
  return Boolean(bundled && fs.existsSync(bundled));
}

/**
 * 返回内置 Python 的安装目录（用于 PYTHONHOME 等）。
 */
export function getBundledPythonHome(): string | null {
  const dir = getBundledPythonDir();
  return dir && fs.existsSync(dir) ? dir : null;
}
