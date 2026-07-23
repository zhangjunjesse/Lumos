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
      // 下载脚本删安装残包是 best-effort(Windows Defender 可能锁文件);
      // 这里兜底:60MB 残包绝不允许进发布产物。
      const leftoverArchive = path.join(resourcesDir, 'git-bash', 'win32', 'x64', 'PortableGit.7z.exe');
      if (fs.existsSync(leftoverArchive)) {
        throw new Error(
          `[verify-packaged-git-bash] Leftover installer archive packaged: ${leftoverArchive} — download 脚本残包未清理`,
        );
      }
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
