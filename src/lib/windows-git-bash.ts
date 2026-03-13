import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BUNDLED_GIT_BASH_CANDIDATES = [
  path.join('bin', 'bash.exe'),
  path.join('usr', 'bin', 'bash.exe'),
  'bash.exe',
];

const REQUIRED_GIT_BASH_RELATIVE_PATHS = [
  path.join('usr', 'bin', 'cygpath.exe'),
  path.join('usr', 'bin', 'msys-2.0.dll'),
];

export function resolveGitBashRoot(bashPath: string): string | null {
  const normalizedPath = path.resolve(bashPath);
  if (path.basename(normalizedPath).toLowerCase() !== 'bash.exe') {
    return null;
  }

  const binDir = path.dirname(normalizedPath);
  if (path.basename(binDir).toLowerCase() !== 'bin') {
    return null;
  }

  const parentDir = path.dirname(binDir);
  if (path.basename(parentDir).toLowerCase() === 'usr') {
    return path.dirname(parentDir);
  }

  return parentDir;
}

export function getGitBashValidationIssues(bashPath: string): string[] {
  if (!fs.existsSync(bashPath)) {
    return ['bash.exe not found'];
  }

  const gitBashRoot = resolveGitBashRoot(bashPath);
  if (!gitBashRoot) {
    return ['bash.exe must live under a Git Bash bin/ directory'];
  }

  return REQUIRED_GIT_BASH_RELATIVE_PATHS
    .filter((relativePath) => !fs.existsSync(path.join(gitBashRoot, relativePath)))
    .map((relativePath) => `missing ${relativePath}`);
}

export function isGitBashPathUsable(bashPath: string): boolean {
  return getGitBashValidationIssues(bashPath).length === 0;
}

export function getBundledGitBashPath(
  resourcesPath: string,
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  const bundledBaseDir = path.join(resourcesPath, 'git-bash', platform, arch);

  for (const relativePath of BUNDLED_GIT_BASH_CANDIDATES) {
    const candidatePath = path.join(bundledBaseDir, relativePath);
    if (isGitBashPathUsable(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function logInvalidGitBash(label: string, bashPath: string): void {
  const issues = getGitBashValidationIssues(bashPath);
  console.log(`[findGitBash] Skipping ${label}: ${bashPath} (${issues.join(', ')})`);
}

export function findGitBash(): string | null {
  console.log('[findGitBash] Searching for git-bash on Windows...');

  const resourcesPath = process.resourcesPath || path.join(process.cwd(), '..');
  const bundledBashPath = getBundledGitBashPath(resourcesPath);
  if (bundledBashPath) {
    console.log('[findGitBash] ✓ Found bundled git-bash:', bundledBashPath);
    return bundledBashPath;
  }

  const bundledBaseDir = path.join(resourcesPath, 'git-bash', process.platform, process.arch);
  for (const relativePath of BUNDLED_GIT_BASH_CANDIDATES) {
    const candidatePath = path.join(bundledBaseDir, relativePath);
    if (fs.existsSync(candidatePath)) {
      logInvalidGitBash('bundled git-bash candidate', candidatePath);
    }
  }

  const envPath = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  console.log('[findGitBash] Checking env var CLAUDE_CODE_GIT_BASH_PATH:', envPath || 'not set');
  if (envPath) {
    if (isGitBashPathUsable(envPath)) {
      console.log('[findGitBash] ✓ Found via env var:', envPath);
      return envPath;
    }
    logInvalidGitBash('env override', envPath);
  }

  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ];
  console.log('[findGitBash] Checking common paths:', commonPaths);
  for (const candidatePath of commonPaths) {
    console.log('[findGitBash] Checking:', candidatePath, '→', fs.existsSync(candidatePath) ? 'EXISTS' : 'not found');
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    if (isGitBashPathUsable(candidatePath)) {
      console.log('[findGitBash] ✓ Found at common path:', candidatePath);
      return candidatePath;
    }
    logInvalidGitBash('common path candidate', candidatePath);
  }

  console.log('[findGitBash] Trying to locate via "where git" command...');
  try {
    const result = execFileSync('where', ['git'], {
      timeout: 3000,
      stdio: 'pipe',
      shell: true,
    });
    const lines = result.toString().trim().split(/\r?\n/);
    console.log('[findGitBash] "where git" returned:', lines);

    for (const line of lines) {
      const gitExePath = line.trim();
      if (!gitExePath) {
        continue;
      }

      const gitDir = path.dirname(path.dirname(gitExePath));
      const candidates = [
        path.join(gitDir, 'bin', 'bash.exe'),
        path.join(gitDir, 'usr', 'bin', 'bash.exe'),
      ];

      for (const candidatePath of candidates) {
        console.log('[findGitBash] Derived bash path:', candidatePath, '→', fs.existsSync(candidatePath) ? 'EXISTS' : 'not found');
        if (!fs.existsSync(candidatePath)) {
          continue;
        }
        if (isGitBashPathUsable(candidatePath)) {
          console.log('[findGitBash] ✓ Found via git location:', candidatePath);
          return candidatePath;
        }
        logInvalidGitBash('derived git location', candidatePath);
      }
    }
  } catch (error) {
    console.log('[findGitBash] "where git" command failed:', error);
  }

  console.log('[findGitBash] ✗ git-bash not found');
  return null;
}
