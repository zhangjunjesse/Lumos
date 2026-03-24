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
  ['run', 'lint', '--', '--max-warnings=0', ...stagedFiles],
  { cwd: repoRoot, stdio: 'inherit' },
);
