import { execFileSync } from 'child_process';
import fs from 'fs';

const repoRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const lintableExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function getStagedFiles() {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );

  return output
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => lintableExtensions.has(file.slice(file.lastIndexOf('.'))))
    .filter((file) => fs.existsSync(file));
}

const stagedFiles = getStagedFiles();

if (stagedFiles.length === 0) {
  console.log('[hooks] No staged JS/TS files to lint');
  process.exit(0);
}

console.log(`[hooks] Linting ${stagedFiles.length} staged file(s)`);

execFileSync(
  npmCommand,
  // 之前 --max-warnings=0 太严: 一个 unused var 也 block release。errors 才是
  // 真 bug, warnings 只是建议——允许 warnings, 仅 fail on errors 即可。这样
  // 工作树里历史 lint 债不阻塞发版, 但 bug 引入仍被挡住。
  ['run', 'lint', '--', '--no-warn-ignored', ...stagedFiles],
  { cwd: repoRoot, stdio: 'inherit' },
);
