import fs from 'node:fs';
import path from 'node:path';

function resolveCandidateResourceDirs(inputPath) {
  const absoluteInputPath = path.resolve(inputPath);
  return [
    absoluteInputPath,
    path.join(absoluteInputPath, 'resources'),
    path.join(absoluteInputPath, 'Lumos.app', 'Contents', 'Resources'),
    path.join(absoluteInputPath, 'Contents', 'Resources'),
  ];
}

function verifyTarget(inputPath) {
  const checkedPaths = [];
  for (const resourcesDir of resolveCandidateResourceDirs(inputPath)) {
    checkedPaths.push(resourcesDir);
    if (!fs.existsSync(resourcesDir)) continue;

    const candidates = [
      path.join(resourcesDir, 'git-bash', 'win32', 'x64', 'bin', 'bash.exe'),
      path.join(resourcesDir, 'git-bash', 'win32', 'x64', 'usr', 'bin', 'bash.exe'),
    ];
    const bashPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (bashPath) {
      console.log(`[verify-packaged-git-bash] OK: ${bashPath}`);
      return;
    }
  }

  throw new Error(
    `[verify-packaged-git-bash] Missing packaged Git Bash runtime under ${inputPath}; checked: ${checkedPaths.join(', ')}`,
  );
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/verify-packaged-git-bash.mjs <path> [more-paths...]');
  process.exit(1);
}

for (const target of targets) {
  verifyTarget(target);
}
