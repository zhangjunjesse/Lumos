// Reads pre-built runtime bundles from `resources/app-runtime/`.
// Used by the host to back the protocol-handler's `readRuntimeAsset` hook.
//
// In dev (next.js / electron-dev), the bundle path is at the repo root.
// In packaged Electron, it's under `process.resourcesPath`. The lookup is
// done lazily and the result cached.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { RuntimeAsset } from './protocol-handler';

const FILE_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const ALLOWED_NAMES = new Set([
  'react.mjs',
  'react-jsx-runtime.mjs',
  'react-dom.mjs',
  'react-dom-client.mjs',
  'scheduler.mjs',
  'lumos-app.mjs',
  'lumos-ui.mjs',
  'lucide-react.mjs',
  'clsx.mjs',
  'tailwind-merge.mjs',
  'cva.mjs',
  'tailwind.css',
  'manifest.json',
]);

interface RuntimeReaderOptions {
  /** Absolute path to the runtime root. Defaults to `<repoRoot>/resources/app-runtime`. */
  rootDir?: string;
  /** When true, bundles are considered immutable (set far-future cache headers). */
  immutable?: boolean;
}

interface CacheEntry {
  asset: RuntimeAsset;
  mtimeMs: number;
}

const DEFAULT_ROOT = path.resolve(process.cwd(), 'resources/app-runtime');

export class RuntimeAssetReader {
  private rootDir: string;
  private immutable: boolean;
  private cache = new Map<string, CacheEntry>();

  constructor(opts: RuntimeReaderOptions = {}) {
    this.rootDir = opts.rootDir ?? DEFAULT_ROOT;
    this.immutable = opts.immutable ?? false;
  }

  setRootDir(rootDir: string): void {
    if (rootDir !== this.rootDir) {
      this.rootDir = rootDir;
      this.cache.clear();
    }
  }

  async read(name: string): Promise<RuntimeAsset | null> {
    if (!ALLOWED_NAMES.has(name)) return null;
    const filePath = path.join(this.rootDir, name);
    try {
      const stat = await fs.stat(filePath);
      const cached = this.cache.get(name);
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.asset;
      const body = await fs.readFile(filePath);
      const asset: RuntimeAsset = {
        body,
        contentType: FILE_TYPES[path.extname(name)] ?? 'application/octet-stream',
        immutable: this.immutable,
      };
      this.cache.set(name, { asset, mtimeMs: stat.mtimeMs });
      return asset;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Convenience adapter matching ProtocolContext.readRuntimeAsset. */
  asAdapter() {
    return (name: string) => this.read(name);
  }
}

let defaultReader: RuntimeAssetReader | null = null;

export function getDefaultRuntimeAssetReader(): RuntimeAssetReader {
  if (!defaultReader) defaultReader = new RuntimeAssetReader();
  return defaultReader;
}

/**
 * Resolves the runtime root for the current execution context:
 * - In tests / dev (cwd is the repo): repoRoot/resources/app-runtime
 * - In packaged Electron: process.resourcesPath/app-runtime
 *
 * Callers pass `processResourcesPath` from electron's `process.resourcesPath`
 * when bootstrapping; in non-Electron contexts they can omit it.
 */
export function resolveRuntimeRoot(processResourcesPath?: string): string {
  if (processResourcesPath) {
    return path.join(processResourcesPath, 'app-runtime');
  }
  return DEFAULT_ROOT;
}
