#!/usr/bin/env node
// Builds the runtime bundle served at lumos-app://{appId}/_runtime/*.
// Output:
//   resources/app-runtime/react.mjs              — React core
//   resources/app-runtime/react-jsx-runtime.mjs  — JSX automatic runtime
//   resources/app-runtime/react-dom.mjs          — ReactDOM
//   resources/app-runtime/react-dom-client.mjs   — ReactDOM/client (createRoot)
//   resources/app-runtime/scheduler.mjs          — React scheduler shared by ReactDOM/client
//   resources/app-runtime/lumos-app.mjs          — @lumos/app SDK
//   resources/app-runtime/lumos-ui.mjs           — @lumos/ui shadcn re-exports
//   resources/app-runtime/lucide-react.mjs       — lucide icons
//   resources/app-runtime/clsx.mjs               — clsx utility
//   resources/app-runtime/tailwind-merge.mjs     — tailwind-merge
//   resources/app-runtime/cva.mjs                — class-variance-authority
//   resources/app-runtime/tailwind.css           — kitchen-sink Tailwind utilities
//   resources/app-runtime/manifest.json          — bundle metadata + hashes

import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'resources', 'app-runtime');
const require = createRequire(import.meta.url);

// Imports the iframe should resolve via importmap rather than bundling.
const SHARED_EXTERNALS = [
  'react', 'react-dom', 'react/jsx-runtime', 'react-dom/client',
];

// Plugin: rewrite `@/...` aliases to `${REPO_ROOT}/src/...`. Re-runs esbuild's
// resolver so it finds the correct extension (.ts/.tsx/.js/.mjs/etc.).
const ALIAS_PLUGIN = {
  name: 'lumos-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      const target = path.join(REPO_ROOT, 'src', args.path.slice(2));
      const result = await build.resolve(target, {
        kind: args.kind,
        resolveDir: path.dirname(target),
      });
      if (result.errors.length > 0) return { errors: result.errors };
      return { path: result.path, namespace: result.namespace };
    });
  },
};

async function bundle(entryPoint, outFile, { external = [] } = {}) {
  const outPath = path.join(OUT_DIR, outFile);
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: outPath,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'react',
    minify: true,
    sourcemap: false,
    external,
    plugins: [ALIAS_PLUGIN],
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    conditions: ['browser', 'import', 'module', 'default'],
  });
  const stat = await fs.stat(outPath);
  const content = await fs.readFile(outPath);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return { file: outFile, bytes: stat.size, hash };
}

async function bundlePackageEntry(pkg, outFile, opts) {
  // For packages without a default export, esbuild resolves the package's main field.
  return bundle(pkg, outFile, opts);
}

async function writeCjsAsEsmRuntime({
  sourceFile,
  outFile,
  requireMap = {},
  exportKeys,
}) {
  const sourcePath = resolvePackageFile(sourceFile);
  const source = await fs.readFile(sourcePath, 'utf8');
  const outPath = path.join(OUT_DIR, outFile);
  const imports = Object.entries(requireMap)
    .map(([_id, importPath], index) => `import __dep${index} from ${JSON.stringify(importPath)};`)
    .join('\n');
  const cases = Object.keys(requireMap)
    .map((id, index) => `    case ${JSON.stringify(id)}: return __dep${index};`)
    .join('\n');
  const keys = exportKeys ?? Object.keys(require(sourcePath));
  const namedExports = keys
    .filter((key) => key !== 'default')
    .filter((key) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key))
    .map((key, index) => {
      const local = `__cjsExport${index}`;
      return `const ${local} = __cjsModule.${key};\nexport { ${local} as ${key} };`;
    })
    .join('\n');

  const code = `${imports}
const module = { exports: {} };
const exports = module.exports;
function require(id) {
  switch (id) {
${cases}
    default:
      throw new Error('Unsupported runtime require: ' + id);
  }
}

${source}

const __cjsModule = module.exports;
export default __cjsModule;
${namedExports}
`;
  await fs.writeFile(outPath, code, 'utf8');
  const stat = await fs.stat(outPath);
  const content = await fs.readFile(outPath);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return { file: outFile, bytes: stat.size, hash };
}

function resolvePackageFile(packageFile) {
  const [pkg, ...parts] = packageFile.startsWith('@')
    ? packageFile.split('/').slice(0, 2).concat(packageFile.split('/').slice(2))
    : packageFile.split('/');
  const packageName = packageFile.startsWith('@')
    ? `${pkg}/${parts.shift()}`
    : pkg;
  const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
  return path.join(packageRoot, ...parts);
}

async function buildTailwindKitchenSink() {
  // The kitchen-sink CSS scans:
  //   - shadcn primitives (src/components/ui)
  //   - Lumos's globals (variables / theme)
  //   - sdk/ui (re-exports)
  // and emits all utilities used. AI-generated apps will reuse the same
  // utilities (shadcn class names plus Tailwind primitives).
  const inputCss = `
@import "tailwindcss";
@import "${path.join(REPO_ROOT, 'node_modules/tw-animate-css/dist/tw-animate.css')}";

@source "${path.join(REPO_ROOT, 'src/components/ui/**/*.tsx')}";
@source "${path.join(REPO_ROOT, 'src/sdk/**/*.{ts,tsx}')}";

@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.13 0.028 261.692);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.13 0.028 261.692);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.13 0.028 261.692);
    --primary: oklch(0.546 0.245 262.881);
    --primary-foreground: oklch(0.985 0.002 247.839);
    --secondary: oklch(0.967 0.003 264.542);
    --secondary-foreground: oklch(0.21 0.034 264.665);
    --muted: oklch(0.967 0.003 264.542);
    --muted-foreground: oklch(0.551 0.027 264.364);
    --accent: oklch(0.967 0.003 264.542);
    --accent-foreground: oklch(0.21 0.034 264.665);
    --destructive: oklch(0.577 0.245 27.325);
    --destructive-foreground: oklch(0.985 0 0);
    --border: oklch(0.928 0.013 255.508);
    --input: oklch(0.928 0.013 255.508);
    --ring: oklch(0.707 0.022 261.325);
    --radius: 0.625rem;
  }
  .dark {
    --background: oklch(0.13 0.028 261.692);
    --foreground: oklch(0.985 0.002 247.839);
    --card: oklch(0.21 0.034 264.665);
    --card-foreground: oklch(0.985 0.002 247.839);
    --popover: oklch(0.21 0.034 264.665);
    --popover-foreground: oklch(0.985 0.002 247.839);
    --primary: oklch(0.6 0.245 262.881);
    --primary-foreground: oklch(0.13 0.028 261.692);
    --secondary: oklch(0.279 0.041 260.031);
    --secondary-foreground: oklch(0.985 0.002 247.839);
    --muted: oklch(0.279 0.041 260.031);
    --muted-foreground: oklch(0.707 0.022 261.325);
    --accent: oklch(0.279 0.041 260.031);
    --accent-foreground: oklch(0.985 0.002 247.839);
    --destructive: oklch(0.396 0.141 25.723);
    --destructive-foreground: oklch(0.985 0 0);
    --border: oklch(0.279 0.041 260.031);
    --input: oklch(0.279 0.041 260.031);
    --ring: oklch(0.446 0.043 257.281);
  }
  * { border-color: var(--border); }
  body { background: var(--background); color: var(--foreground); }
}
`;

  const result = await postcss([tailwind()]).process(inputCss, {
    from: path.join(OUT_DIR, '_input.css'),
    to: path.join(OUT_DIR, 'tailwind.css'),
  });
  const outPath = path.join(OUT_DIR, 'tailwind.css');
  await fs.writeFile(outPath, result.css, 'utf8');
  const stat = await fs.stat(outPath);
  return { file: 'tailwind.css', bytes: stat.size };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`Building app runtime to ${path.relative(REPO_ROOT, OUT_DIR)}/`);
  const t0 = Date.now();

  const results = [];

  // Core React (browser-targeted). React ships CJS files, so generate ESM wrappers
  // that keep a single shared React module instance and avoid dynamic require().
  results.push(await writeCjsAsEsmRuntime({
    sourceFile: 'react/cjs/react.production.js',
    outFile: 'react.mjs',
  }));
  results.push(await writeCjsAsEsmRuntime({
    sourceFile: 'react/cjs/react-jsx-runtime.production.js',
    outFile: 'react-jsx-runtime.mjs',
  }));
  results.push(await writeCjsAsEsmRuntime({
    sourceFile: 'scheduler/cjs/scheduler.production.js',
    outFile: 'scheduler.mjs',
  }));
  results.push(await writeCjsAsEsmRuntime({
    sourceFile: 'react-dom/cjs/react-dom.production.js',
    outFile: 'react-dom.mjs',
    requireMap: {
      react: './react.mjs',
    },
  }));
  results.push(await writeCjsAsEsmRuntime({
    sourceFile: 'react-dom/cjs/react-dom-client.production.js',
    outFile: 'react-dom-client.mjs',
    requireMap: {
      scheduler: './scheduler.mjs',
      react: './react.mjs',
      'react-dom': './react-dom.mjs',
    },
  }));

  // SDK
  results.push(await bundle(path.join(REPO_ROOT, 'src/sdk/app/index.ts'), 'lumos-app.mjs', { external: SHARED_EXTERNALS }));
  results.push(await bundle(path.join(REPO_ROOT, 'src/sdk/ui/index.ts'), 'lumos-ui.mjs', {
    external: [...SHARED_EXTERNALS, 'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority'],
  }));

  // Helpers (each as its own importmap target; tree-shaking inside each module).
  results.push(await bundlePackageEntry('lucide-react', 'lucide-react.mjs', { external: SHARED_EXTERNALS }));
  results.push(await bundlePackageEntry('clsx', 'clsx.mjs'));
  results.push(await bundlePackageEntry('tailwind-merge', 'tailwind-merge.mjs'));
  results.push(await bundlePackageEntry('class-variance-authority', 'cva.mjs', { external: ['clsx'] }));

  // Tailwind kitchen-sink.
  console.log('Compiling Tailwind kitchen-sink CSS…');
  const css = await buildTailwindKitchenSink();

  // Manifest with hashes (used by host to cache bust).
  const manifest = {
    builtAt: new Date().toISOString(),
    bundles: results,
    css,
  };
  await fs.writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  const totalKb = results.reduce((s, r) => s + r.bytes, 0) / 1024;
  console.log(`Built ${results.length} bundles + tailwind.css (${(css.bytes / 1024).toFixed(1)}KB JS+${totalKb.toFixed(1)}KB) in ${Date.now() - t0}ms`);
  for (const r of results) {
    console.log(`  ${r.file.padEnd(28)} ${(r.bytes / 1024).toFixed(1).padStart(7)}KB  ${r.hash}`);
  }
}

main().catch((err) => {
  console.error('build-app-runtime failed:', err);
  process.exit(1);
});
