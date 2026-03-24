import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const hooksDir = path.join(repoRoot, '.githooks');
const hookFiles = ['pre-commit', 'pre-push'];

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  }).trim();
}

function isGitRepo() {
  try {
    runGit(['rev-parse', '--show-toplevel']);
    return true;
  } catch {
    return false;
  }
}

if (process.env.CI === 'true' || process.env.CI === '1') {
  process.exit(0);
}

if (!isGitRepo()) {
  process.exit(0);
}

if (!fs.existsSync(hooksDir)) {
  console.warn(`[hooks] Skipping install because ${hooksDir} does not exist`);
  process.exit(0);
}

try {
  try {
    runGit(['config', '--worktree', 'core.hooksPath', hooksDir]);
  } catch {
    runGit(['config', '--local', 'core.hooksPath', hooksDir]);
  }
  for (const hookFile of hookFiles) {
    const hookPath = path.join(hooksDir, hookFile);
    if (fs.existsSync(hookPath)) {
      fs.chmodSync(hookPath, 0o755);
    }
  }
  console.log(`[hooks] Installed project-local git hooks at ${hooksDir}`);
} catch (error) {
  console.warn('[hooks] Failed to install git hooks:', error instanceof Error ? error.message : error);
}
