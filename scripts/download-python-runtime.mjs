#!/usr/bin/env node
/**
 * 下载 python-build-standalone 的 install_only 包到 resources/python-runtime/
 *
 * 用法:
 *   node scripts/download-python-runtime.mjs              # 下载当前平台
 *   node scripts/download-python-runtime.mjs --all        # 下载所有平台
 *   node scripts/download-python-runtime.mjs --platform darwin --arch arm64
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const OUTPUT_BASE = path.join(PROJECT_ROOT, 'resources', 'python-runtime');

// python-build-standalone 配置
const PYTHON_VERSION = '3.12.8';
const STANDALONE_RELEASE = '20241219';
const GITHUB_BASE = 'https://github.com/astral-sh/python-build-standalone/releases/download';

// 平台映射：Node.js platform/arch → python-build-standalone 命名
const PLATFORM_MAP = {
  'darwin-arm64': {
    asset: `cpython-${PYTHON_VERSION}+${STANDALONE_RELEASE}-aarch64-apple-darwin-install_only.tar.gz`,
    binRelPath: 'python/bin/python3',
  },
  'darwin-x64': {
    asset: `cpython-${PYTHON_VERSION}+${STANDALONE_RELEASE}-x86_64-apple-darwin-install_only.tar.gz`,
    binRelPath: 'python/bin/python3',
  },
  'win32-x64': {
    asset: `cpython-${PYTHON_VERSION}+${STANDALONE_RELEASE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
    binRelPath: 'python/python.exe',
  },
  'linux-x64': {
    asset: `cpython-${PYTHON_VERSION}+${STANDALONE_RELEASE}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
    binRelPath: 'python/bin/python3',
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    return Object.keys(PLATFORM_MAP);
  }

  let platform = process.platform;
  let arch = process.arch;

  const platIdx = args.indexOf('--platform');
  if (platIdx !== -1 && args[platIdx + 1]) {
    platform = args[platIdx + 1];
  }
  const archIdx = args.indexOf('--arch');
  if (archIdx !== -1 && args[archIdx + 1]) {
    arch = args[archIdx + 1];
  }

  const key = `${platform}-${arch}`;
  if (!PLATFORM_MAP[key]) {
    console.error(`❌ 不支持的平台: ${key}`);
    console.error(`   支持的平台: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }
  return [key];
}

async function downloadFile(url, destPath) {
  console.log(`   下载: ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`);
  }

  const totalBytes = Number(response.headers.get('content-length') || 0);
  let downloadedBytes = 0;
  let lastPercent = -1;

  const destDir = path.dirname(destPath);
  fs.mkdirSync(destDir, { recursive: true });

  const fileStream = createWriteStream(destPath);
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloadedBytes += value.length;

    if (totalBytes > 0) {
      const percent = Math.floor((downloadedBytes / totalBytes) * 100);
      if (percent !== lastPercent && percent % 10 === 0) {
        process.stdout.write(`   进度: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)\r`);
        lastPercent = percent;
      }
    }
  }

  fileStream.end();
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  console.log(`   完成: ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB`);
}

function extractTarGz(archivePath, outputDir) {
  console.log(`   解压到: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync('tar', ['xzf', archivePath, '-C', outputDir], {
    stdio: 'pipe',
    timeout: 60_000,
  });
}

async function downloadPlatform(platformKey) {
  const config = PLATFORM_MAP[platformKey];
  const [platform, arch] = platformKey.split('-');
  const outputDir = path.join(OUTPUT_BASE, platform, arch);

  // 检查是否已下载
  const binPath = path.join(outputDir, config.binRelPath);
  if (fs.existsSync(binPath)) {
    console.log(`✅ ${platformKey}: 已存在，跳过 (${binPath})`);
    return;
  }

  console.log(`📦 ${platformKey}: 开始下载...`);

  const url = `${GITHUB_BASE}/${STANDALONE_RELEASE}/${config.asset}`;
  const tmpDir = path.join(PROJECT_ROOT, '.tmp-python-download');
  fs.mkdirSync(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, config.asset);

  try {
    await downloadFile(url, archivePath);
    extractTarGz(archivePath, outputDir);

    // 验证解压后的二进制存在
    if (!fs.existsSync(binPath)) {
      throw new Error(`解压后找不到 Python 二进制: ${binPath}`);
    }

    // 确保可执行权限（Unix）
    if (platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
    }

    // 验证可运行
    if (platform === process.platform && arch === process.arch) {
      try {
        const version = execFileSync(binPath, ['--version'], {
          stdio: 'pipe',
          timeout: 5000,
        }).toString().trim();
        console.log(`   验证通过: ${version}`);
      } catch (err) {
        console.warn(`   ⚠️ 二进制存在但无法运行: ${err.message}`);
      }
    }

    console.log(`✅ ${platformKey}: 完成`);
  } finally {
    // 清理临时文件
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function main() {
  const targets = parseArgs();
  console.log(`\n🐍 下载 Python ${PYTHON_VERSION} (python-build-standalone)\n`);
  console.log(`   目标平台: ${targets.join(', ')}`);
  console.log(`   输出目录: ${OUTPUT_BASE}\n`);

  for (const target of targets) {
    await downloadPlatform(target);
  }

  console.log('\n✅ 全部完成\n');
}

main().catch((err) => {
  console.error(`\n❌ 失败: ${err.message}\n`);
  process.exit(1);
});
