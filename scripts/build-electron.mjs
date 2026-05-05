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

async function buildElectron() {
  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    // App preview compiles builder drafts at runtime. esbuild's JS API must
    // stay external because it locates its native binary relative to its own
    // package files; bundling it into dist-electron/main.js breaks that path.
    external: ['electron', 'better-sqlite3', 'esbuild'],
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
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});
