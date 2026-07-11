/* eslint-disable @typescript-eslint/no-require-imports */
// SDK 0.3.x 起 Claude Code 运行时是平台原生二进制,随
// @anthropic-ai/claude-agent-sdk-<platform>-<arch> 分发。npm 只会装当前机器
// 架构的那个,而 mac CI 在一台 runner 上产出双架构 DMG,所以打包后按目标架构
// 把对应平台包注入 standalone/node_modules,本地缺包时用 npm pack 拉取,并按
// SDK manifest.json 的 sha256 校验,防镜像坏包。
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// electron-builder Arch 枚举值 → node 架构名
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
const SCOPE = '@anthropic-ai';
const SDK_PACKAGE = `${SCOPE}/claude-agent-sdk`;

function resolvePackagedResourcesDir(appOutDir) {
  const candidates = [
    path.join(appOutDir, 'resources'),
    path.join(appOutDir, 'Lumos.app', 'Contents', 'Resources'),
    path.join(appOutDir, 'Contents', 'Resources'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`[afterPack:agent-sdk] Packaged resources directory not found under ${appOutDir}`);
}

function readSdkManifest(projectDir) {
  const manifestPath = path.join(projectDir, 'node_modules', SDK_PACKAGE, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function readSdkVersion(projectDir) {
  const pkgPath = path.join(projectDir, 'node_modules', SDK_PACKAGE, 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function binaryMatchesManifest(binaryPath, platformMeta) {
  if (!fs.existsSync(binaryPath)) return false;
  if (fs.statSync(binaryPath).size !== platformMeta.size) return false;
  return sha256(binaryPath) === platformMeta.checksum;
}

// npm pack 拉平台包(唯一的跨架构获取途径),解到临时目录后返回 package 根。
function fetchPlatformPackage(packageName, version) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-pack-'));
  console.log(`[afterPack:agent-sdk] Fetching ${packageName}@${version} via npm pack ...`);
  const stdout = execFileSync('npm', ['pack', `${packageName}@${version}`, '--pack-destination', workDir], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tarball = path.join(workDir, stdout.trim().split('\n').pop());
  execFileSync('tar', ['-xzf', tarball, '-C', workDir], { stdio: 'inherit' });
  return path.join(workDir, 'package');
}

module.exports = async function afterPackEnsureAgentSdk(context) {
  const platform = context.electronPlatformName;
  const archName = ARCH_NAMES[context.arch] ?? String(context.arch);
  if (archName === 'universal') {
    throw new Error('[afterPack:agent-sdk] universal build is not supported; build per-arch');
  }

  const projectDir = process.cwd();
  const platformKey = `${platform}-${archName}`;
  const manifest = readSdkManifest(projectDir);
  const platformMeta = manifest.platforms?.[platformKey];
  if (!platformMeta) {
    throw new Error(`[afterPack:agent-sdk] No manifest entry for ${platformKey}`);
  }

  const packageName = `${SCOPE}/claude-agent-sdk-${platformKey}`;
  const packagedResourcesDir = resolvePackagedResourcesDir(context.appOutDir);
  const targetDir = path.join(packagedResourcesDir, 'standalone', 'node_modules', SCOPE, `claude-agent-sdk-${platformKey}`);
  const targetBinary = path.join(targetDir, platformMeta.binary);

  if (!binaryMatchesManifest(targetBinary, platformMeta)) {
    const localSource = path.join(projectDir, 'node_modules', SCOPE, `claude-agent-sdk-${platformKey}`);
    const sourceDir = binaryMatchesManifest(path.join(localSource, platformMeta.binary), platformMeta)
      ? localSource
      : fetchPlatformPackage(packageName, readSdkVersion(projectDir));

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
  }

  if (!binaryMatchesManifest(targetBinary, platformMeta)) {
    throw new Error(`[afterPack:agent-sdk] ${platformKey} binary missing or checksum mismatch at ${targetBinary}`);
  }
  if (platform !== 'win32') {
    fs.chmodSync(targetBinary, 0o755);
  }
  console.log(`[afterPack:agent-sdk] Verified ${platformKey} runtime at ${targetBinary}`);
};
