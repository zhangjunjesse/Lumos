// Resolves a `lumos-app://{appId}/{path}` request into an HTTP-style response.
// Electron main process wraps this with protocol.handle(), but the function
// itself is environment-agnostic and unit-testable.

import { buildShellHtml } from './shell-html';
import type { CompiledModule, ManifestV2 } from '@/lib/app/compile/types';

export interface ProtocolRequest {
  /** e.g. 'lumos-app://crm-mini/' or 'lumos-app://crm-mini/_app/pages/index.tsx.mjs' */
  url: string;
}

export interface ProtocolResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

export interface ProtocolContext {
  /** Resolves the manifest and compiled modules for an app. Implemented by host. */
  loadApp(appId: string): Promise<LoadedApp | null>;
  /**
   * Reads a runtime asset (react.mjs / lumos-app.mjs / tailwind.css / etc.)
   * Implemented by host; typically reads from resources/app-runtime/.
   */
  readRuntimeAsset(name: string): Promise<RuntimeAsset | null>;
}

export interface LoadedApp {
  manifest: ManifestV2;
  modules: CompiledModule[];
}

export interface RuntimeAsset {
  body: string | Uint8Array;
  contentType: string;
  /** Whether to mark immutable (true for hashed prod assets, false in dev). */
  immutable?: boolean;
}

const RUNTIME_PREFIX = '_runtime/';
const APP_PREFIX = '_app/';
const ASSET_PREFIX = '_assets/';

export async function handleProtocolRequest(
  req: ProtocolRequest,
  ctx: ProtocolContext,
): Promise<ProtocolResponse> {
  const parsed = parseAppUrl(req.url);
  if (!parsed) {
    return notFound('invalid lumos-app:// url');
  }
  const { appId, path } = parsed;

  // Shell HTML (root)
  if (path === '' || path === '/') {
    const app = await ctx.loadApp(appId);
    if (!app) return notFound(`app not found: ${appId}`);
    const entryRoute = app.manifest.routes.find((r) => r.id === app.manifest.entry);
    if (!entryRoute) return badGateway(`manifest.entry "${app.manifest.entry}" not in routes`);
    const html = buildShellHtml({
      appId,
      manifest: app.manifest,
      entryModulePath: `/${APP_PREFIX}${entryRoute.page}.mjs`,
    });
    return ok(html, 'text/html; charset=utf-8');
  }

  // Runtime assets (shared across apps; host caches aggressively)
  if (path.startsWith(RUNTIME_PREFIX)) {
    const name = path.slice(RUNTIME_PREFIX.length);
    if (!isSafeAssetName(name)) return notFound('invalid runtime asset path');
    const asset = await ctx.readRuntimeAsset(name);
    if (!asset) return notFound(`runtime asset not found: ${name}`);
    return {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
      body: asset.body,
    };
  }

  // Compiled app modules
  if (path.startsWith(APP_PREFIX)) {
    const inner = path.slice(APP_PREFIX.length);
    const sourcePath = inner.endsWith('.mjs') ? inner.slice(0, -'.mjs'.length) : inner;
    if (!isSafeAssetName(sourcePath)) return notFound('invalid module path');
    const app = await ctx.loadApp(appId);
    if (!app) return notFound(`app not found: ${appId}`);
    const mod = findModuleForRequest(app.modules, sourcePath);
    if (!mod) return notFound(`module not found: ${sourcePath}`);
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Lumos-Hash': mod.hash,
      },
      body: mod.code,
    };
  }

  // Static assets bundled with the app (logos, etc.)
  if (path.startsWith(ASSET_PREFIX)) {
    return notFound('static assets not implemented yet');
  }

  return notFound(`unknown path: ${path}`);
}

// ---- Helpers -------------------------------------------------------------

function findModuleForRequest(modules: CompiledModule[], sourcePath: string): CompiledModule | undefined {
  const exact = modules.find((m) => m.path === sourcePath);
  if (exact) return exact;

  // Browser ESM keeps relative imports like "../lib/foo" extensionless.
  // The protocol serves compiled TS/TSX sources by their source path, so map
  // extensionless requests back to the actual app source file.
  if (/\.[a-z0-9]+$/i.test(sourcePath)) {
    return undefined;
  }

  const candidates = [
    `${sourcePath}.ts`,
    `${sourcePath}.tsx`,
    `${sourcePath}.js`,
    `${sourcePath}.jsx`,
  ];
  return modules.find((m) => candidates.includes(m.path));
}

export function parseAppUrl(url: string): { appId: string; path: string } | null {
  const m = url.match(/^lumos-app:\/\/([a-z][a-z0-9-]{2,63})(?:\/(.*))?$/);
  if (!m) return null;
  return { appId: m[1], path: m[2] ?? '' };
}

function isSafeAssetName(name: string): boolean {
  if (!name) return false;
  if (name.includes('..')) return false;
  if (name.startsWith('/')) return false;
  return /^[a-zA-Z0-9._\-/]+$/.test(name);
}

function ok(body: string | Uint8Array, contentType: string): ProtocolResponse {
  return {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
    body,
  };
}

function notFound(reason: string): ProtocolResponse {
  return {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: `Not Found: ${reason}`,
  };
}

function badGateway(reason: string): ProtocolResponse {
  return {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: `Bad Gateway: ${reason}`,
  };
}
