import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FILES = [
  path.join('python-runtime', 'win32', 'x64', 'python', 'python.exe'),
  path.join('mcp-servers', 'wechat-export', 'server.py'),
  path.join('mcp-servers', 'wechat-export', 'windows', 'api.py'),
  path.join('mcp-servers', 'wechat-export', 'windows', 'extract_key.py'),
  path.join('mcp-servers', 'wechat-export', 'windows', 'server.py'),
  path.join('standalone', 'public', 'mcp-servers', 'wechat-export.json'),
];

function resolveCandidateResourceDirs(inputPath) {
  const absoluteInputPath = path.resolve(inputPath);
  return [
    absoluteInputPath,
    path.join(absoluteInputPath, 'resources'),
    path.join(absoluteInputPath, 'Lumos.app', 'Contents', 'Resources'),
    path.join(absoluteInputPath, 'Contents', 'Resources'),
  ];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function verifyTarget(inputPath) {
  const checkedPaths = [];
  const failures = [];

  for (const resourcesDir of resolveCandidateResourceDirs(inputPath)) {
    checkedPaths.push(resourcesDir);
    if (!fs.existsSync(resourcesDir)) continue;

    const missing = REQUIRED_FILES.filter((relativePath) => !fs.existsSync(path.join(resourcesDir, relativePath)));
    if (missing.length > 0) {
      failures.push(`${resourcesDir}: missing [${missing.join(', ')}]`);
      continue;
    }

    const configPath = path.join(resourcesDir, 'standalone', 'public', 'mcp-servers', 'wechat-export.json');
    const config = readJson(configPath);
    const args = Array.isArray(config.args) ? config.args.join('\n') : '';
    if (!args.includes('mcp-servers/wechat-export/server.py')) {
      failures.push(`${resourcesDir}: wechat-export.json does not point at platform dispatcher`);
      continue;
    }
    if (config.runtime !== 'python' || config.command !== '[PYTHON_PATH]') {
      failures.push(`${resourcesDir}: wechat-export runtime must stay python/[PYTHON_PATH]`);
      continue;
    }

    console.log(`[verify-packaged-wechat-export] OK: ${resourcesDir}`);
    return;
  }

  throw new Error(
    `[verify-packaged-wechat-export] Missing packaged Windows WeChat resources under ${inputPath}; checked: ${checkedPaths.join(', ')}; failures: ${failures.join(' | ')}`,
  );
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/verify-packaged-wechat-export.mjs <path> [more-paths...]');
  process.exit(1);
}

for (const target of targets) {
  verifyTarget(target);
}
