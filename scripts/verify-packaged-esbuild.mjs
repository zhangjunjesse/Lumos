import fs from 'node:fs';
import path from 'node:path';

const PLATFORM_PACKAGES = {
  'darwin:arm64': { packagePath: path.join('@esbuild', 'darwin-arm64'), binary: path.join('bin', 'esbuild') },
  'darwin:x64': { packagePath: path.join('@esbuild', 'darwin-x64'), binary: path.join('bin', 'esbuild') },
  'linux:arm64': { packagePath: path.join('@esbuild', 'linux-arm64'), binary: path.join('bin', 'esbuild') },
  'linux:x64': { packagePath: path.join('@esbuild', 'linux-x64'), binary: path.join('bin', 'esbuild') },
  'win32:arm64': { packagePath: path.join('@esbuild', 'win32-arm64'), binary: 'esbuild.exe' },
  'win32:ia32': { packagePath: path.join('@esbuild', 'win32-ia32'), binary: 'esbuild.exe' },
  'win32:x64': { packagePath: path.join('@esbuild', 'win32-x64'), binary: 'esbuild.exe' },
};

function parseArgs(argv) {
  const opts = {
    platform: process.platform,
    arch: process.arch,
    targets: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--platform=')) {
      opts.platform = arg.slice('--platform='.length);
    } else if (arg.startsWith('--arch=')) {
      opts.arch = arg.slice('--arch='.length);
    } else {
      opts.targets.push(arg);
    }
  }

  return opts;
}

function resolveCandidateResourceDirs(inputPath) {
  const absoluteInputPath = path.resolve(inputPath);
  return [
    absoluteInputPath,
    path.join(absoluteInputPath, 'resources'),
    path.join(absoluteInputPath, 'Lumos.app', 'Contents', 'Resources'),
    path.join(absoluteInputPath, 'Contents', 'Resources'),
  ];
}

function verifyTarget(inputPath, platform, arch) {
  const key = `${platform}:${arch}`;
  const platformPackage = PLATFORM_PACKAGES[key];
  if (!platformPackage) {
    throw new Error(`[verify-packaged-esbuild] Unsupported platform/arch: ${key}`);
  }

  const checkedPaths = [];
  const failures = [];

  for (const resourcesDir of resolveCandidateResourceDirs(inputPath)) {
    checkedPaths.push(resourcesDir);
    if (!fs.existsSync(resourcesDir)) continue;

    const requiredLocations = [
      {
        label: 'main-process',
        nodeModulesDir: path.join(resourcesDir, 'app.asar.unpacked', 'node_modules'),
      },
      {
        label: 'standalone-server',
        nodeModulesDir: path.join(resourcesDir, 'standalone', 'node_modules'),
      },
    ];
    const missing = requiredLocations.flatMap((location) =>
      listMissingFiles(location.nodeModulesDir, platformPackage).map((filePath) =>
        `${location.label}:${path.relative(resourcesDir, filePath)}`,
      ),
    );
    if (missing.length === 0) {
      console.log(`[verify-packaged-esbuild] OK (${key}): ${resourcesDir}`);
      return;
    }

    failures.push(`${resourcesDir}: missing [${missing.join(', ')}]`);
  }

  throw new Error(
    `[verify-packaged-esbuild] Missing packaged esbuild runtime for ${key} under ${inputPath}; checked: ${checkedPaths.join(', ')}; failures: ${failures.join(' | ')}`,
  );
}

function listMissingFiles(nodeModulesDir, platformPackage) {
  return [
    path.join(nodeModulesDir, 'esbuild', 'package.json'),
    path.join(nodeModulesDir, 'esbuild', 'lib', 'main.js'),
    path.join(nodeModulesDir, platformPackage.packagePath, 'package.json'),
    path.join(nodeModulesDir, platformPackage.packagePath, platformPackage.binary),
  ].filter((filePath) => !fs.existsSync(filePath));
}

const opts = parseArgs(process.argv.slice(2));
if (opts.targets.length === 0) {
  console.error('Usage: node scripts/verify-packaged-esbuild.mjs [--platform=win32] [--arch=x64] <path> [more-paths...]');
  process.exit(1);
}

for (const target of opts.targets) {
  verifyTarget(target, opts.platform, opts.arch);
}
