import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

// Replace symlinks in standalone with real copies so electron-builder can package them
function resolveStandaloneSymlinks() {
  const standaloneModules = '.next/standalone/.next/node_modules';
  if (!fs.existsSync(standaloneModules)) return;

  const entries = fs.readdirSync(standaloneModules);
  for (const entry of entries) {
    const fullPath = path.join(standaloneModules, entry);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(fullPath);
      const resolved = path.resolve(standaloneModules, target);
      if (fs.existsSync(resolved)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        fs.cpSync(resolved, fullPath, { recursive: true });
        console.log(`Resolved symlink: ${entry} -> ${target}`);
      }
    }
  }
}

// Next standalone sometimes traces only `package.json` for
// `onnxruntime-web/node_modules/onnxruntime-common`, but omits its `dist/`.
// In packaged Electron builds this breaks the Node entry of `onnxruntime-web`
// before the knowledge embedder can initialize.
function hydrateOnnxruntimeWebDependency() {
  const standaloneRoot = '.next/standalone/node_modules';
  const rootCommonDir = path.join(standaloneRoot, 'onnxruntime-common');
  const nestedCommonDir = path.join(
    standaloneRoot,
    'onnxruntime-web',
    'node_modules',
    'onnxruntime-common',
  );

  const sourceDist = path.join(rootCommonDir, 'dist');
  const nestedDist = path.join(nestedCommonDir, 'dist');

  if (!fs.existsSync(sourceDist) || !fs.existsSync(nestedCommonDir)) {
    return;
  }

  if (fs.existsSync(path.join(nestedDist, 'cjs', 'index.js'))) {
    return;
  }

  fs.mkdirSync(nestedCommonDir, { recursive: true });
  fs.cpSync(sourceDist, nestedDist, { recursive: true });
  console.log('Hydrated onnxruntime-web nested onnxruntime-common dist');
}

function hydrateStandaloneEsbuildDependency() {
  const standaloneModules = '.next/standalone/node_modules';
  if (!fs.existsSync(standaloneModules)) return;

  copyStandalonePackage('esbuild');

  const rootEsbuildScope = path.join('node_modules', '@esbuild');
  if (!fs.existsSync(rootEsbuildScope)) return;

  for (const entry of fs.readdirSync(rootEsbuildScope)) {
    copyStandalonePackage(path.join('@esbuild', entry));
  }
}

function copyStandalonePackage(packageName) {
  const source = path.join('node_modules', packageName);
  if (!fs.existsSync(source)) return;

  const destination = path.join('.next/standalone/node_modules', packageName);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  console.log(`Hydrated standalone package: ${packageName}`);
}

async function buildElectron() {
  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    // Native modules with .node bindings must stay external — esbuild has no
    // loader for .node and they locate their platform-specific binary from
    // their own package files at runtime. electron-builder ships them
    // unpacked.
    external: [
      'electron',
      'better-sqlite3',
      'esbuild',
      '@node-rs/jieba',
      'onnxruntime-node',
      // playwright 是重型 node 运行时模块（CDP 接管浏览器，选品采集/x-radar 等用）：
      // 运行时从 node_modules require，绝不 bundle 进 electron 主进程；其内部按需 require
      // chromium-bidi，一并 external。与 better-sqlite3 / onnxruntime 同类。
      'playwright',
      'playwright-core',
      'chromium-bidi',
      // @resvg/resvg-js 是 napi-rs native binding：主包 require 平台子包（含 .node 文件）。
      // esbuild 没 .node loader，必须 external，运行时 node_modules 里 require。
      '@resvg/resvg-js',
      '@resvg/resvg-js-darwin-x64',
      '@resvg/resvg-js-darwin-arm64',
      '@resvg/resvg-js-linux-x64-gnu',
      '@resvg/resvg-js-linux-arm64-gnu',
      '@resvg/resvg-js-win32-x64-msvc',
    ],
    sourcemap: true,
    minify: false,
  };

  await build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.js',
  });

  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.js',
  });

  // Preload for built-in browser tabs (chrome.runtime stealth patch).
  // Loaded by BrowserManager.createView(); covers user-opened tabs, AI
  // chrome-devtools MCP sessions, workflow agent code steps, and
  // DeepSearch background pages. Sandboxed; only uses electron.webFrame.
  await build({
    ...shared,
    entryPoints: ['electron/browser/browser-tab-preload.ts'],
    outfile: 'dist-electron/browser-tab-preload.js',
  });

  console.log('Electron build complete');

  // Fix standalone symlinks after next build
  resolveStandaloneSymlinks();
  hydrateOnnxruntimeWebDependency();
  hydrateStandaloneEsbuildDependency();
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});
