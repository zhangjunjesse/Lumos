#!/usr/bin/env node
/**
 * lumos-app CLI — minimal developer helper.
 *
 *   node scripts/lumos-app.mjs validate <dir>
 *       Run parseApp + validateApp on a directory and exit 0 on success.
 *
 *   node scripts/lumos-app.mjs pack <dir> <output.lumos-app>
 *       Validate, then zip into a distributable .lumos-app file.
 *
 * Architecture doc §11.3 calls for a published npm package (`@lumos/cli`)
 * eventually; per the requirements we keep this in-repo as a script for
 * M2 — the packaged version lands with M7 (marketplace).
 *
 * Implementation: bundle the relevant TS code via esbuild at startup
 * (lumos doesn't ship ts-node), import the resulting bundle, then run
 * the requested command. Adds a single esbuild step (~100ms) — fine for
 * a developer-side helper that runs occasionally.
 */

import { build } from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const [, , cmd, ...rest] = process.argv;

function usage(code = 0) {
  console.log(`Usage:
  lumos-app validate <dir>
  lumos-app pack <dir> <output.lumos-app>
`);
  process.exit(code);
}

if (!cmd) usage(1);
if (cmd === '-h' || cmd === '--help' || cmd === 'help') usage(0);
if (cmd !== 'validate' && cmd !== 'pack') {
  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

// Tell the bundled ajv-instance where to find the JSON Schemas — once
// bundled with esbuild, `__dirname` no longer points at the source tree.
process.env.LUMOS_APP_SCHEMA_DIR = path.join(ROOT, 'resources', 'app-schemas');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-cli-'));
const bundlePath = path.join(tmp, 'cli-bundle.mjs');

const manifestEntry = path.join(ROOT, 'src/lib/app/manifest/index.ts');
const packEntry = path.join(ROOT, 'src/lib/app/installer/pack.ts');
const entryShim = [
  'import { parseApp, validateApp } from ' + JSON.stringify(manifestEntry) + ';',
  'import { packApp } from ' + JSON.stringify(packEntry) + ';',
  'export { parseApp, validateApp, packApp };',
].join('\n');
const entryPath = path.join(tmp, 'entry.ts');
fs.writeFileSync(entryPath, entryShim);

await build({
  entryPoints: [entryPath],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3', 'electron'],
  logLevel: 'silent',
  // ESM bundle has no __dirname/__filename; shim them for any bundled
  // module that referenced these CommonJS globals.
  banner: {
    js: [
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __dirname_fn } from "path";',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirname_fn(__filename);',
    ].join('\n'),
  },
});

const { parseApp, validateApp, packApp } = await import(pathToFileURL(bundlePath).href);

function reportIssues(issues) {
  for (const i of issues) {
    const tag = i.level === 'error' ? '✖' : '⚠';
    console.log(
      `${tag} ${i.file}${i.jsonPath ? i.jsonPath : ''}: ${i.message}${
        i.hint ? ` — ${i.hint}` : ''
      }`,
    );
  }
}

async function main() {
  switch (cmd) {
    case 'validate': {
      const [dir] = rest;
      if (!dir) usage(1);
      const parsed = parseApp(dir);
      if (!parsed.ok) {
        console.error('Manifest validation failed:');
        reportIssues(parsed.issues);
        process.exit(1);
      }
      const cross = validateApp(parsed.app);
      const errors = cross.filter((i) => i.level === 'error');
      if (errors.length > 0) {
        console.error('Cross-file validation failed:');
        reportIssues(cross);
        process.exit(1);
      }
      console.log(`✔ ${parsed.app.manifest.id} v${parsed.app.manifest.version} OK`);
      reportIssues(cross.filter((i) => i.level === 'warning'));
      return;
    }
    case 'pack': {
      const [dir, out] = rest;
      if (!dir || !out) usage(1);
      const result = await packApp(dir, out);
      if (!result.ok) {
        console.error(result.message);
        reportIssues(result.issues);
        process.exit(1);
      }
      console.log(`✔ Packed ${dir} → ${result.outputPath} (${result.sizeBytes} bytes)`);
      reportIssues(result.warnings);
      return;
    }
  }
}

try {
  await main();
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
