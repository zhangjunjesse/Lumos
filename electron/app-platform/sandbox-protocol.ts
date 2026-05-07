// Registers the `lumos-app://` custom protocol for the React-in-iframe sandbox.
//
// Usage from electron/main.ts:
//
//   import { protocol } from 'electron';
//   import { registerSandboxProtocolScheme, registerSandboxProtocol } from './app-platform/sandbox-protocol';
//   import { AppLoader, BuilderSessionSourceProvider } from '@/lib/app/sandbox/app-loader';
//   import { RuntimeAssetReader, resolveRuntimeRoot } from '@/lib/app/sandbox/runtime-assets';
//
//   // Before app.whenReady():
//   registerSandboxProtocolScheme();
//
//   // After app.whenReady():
//   const loader = new AppLoader({
//     source: new BuilderSessionSourceProvider({
//       listArtifacts: (sessionId) => store.getCurrentArtifacts(sessionId).map(a => ({ filePath: a.filePath, content: a.content })),
//     }),
//   });
//   const reader = new RuntimeAssetReader({ rootDir: resolveRuntimeRoot(process.resourcesPath) });
//   registerSandboxProtocol({ protocol, appLoader: loader, runtimeAssets: reader });

import { protocol as defaultProtocol, type Protocol } from 'electron';

import { handleProtocolRequest, type LoadedApp } from '@/lib/app/sandbox/protocol-handler';
import type { AppLoader } from '@/lib/app/sandbox/app-loader';
import type { RuntimeAssetReader } from '@/lib/app/sandbox/runtime-assets';

export const SANDBOX_PROTOCOL_SCHEME = 'lumos-app';

export interface SandboxProtocolDeps {
  /** Optional override for tests; defaults to the imported `electron.protocol`. */
  protocol?: Protocol;
  appLoader: AppLoader;
  runtimeAssets: RuntimeAssetReader;
}

/**
 * Registers `lumos-app` as a privileged scheme. Must be called before
 * `app.whenReady()` (Electron requires scheme registration to happen during
 * the app's first event loop tick).
 */
export function registerSandboxProtocolScheme(): void {
  defaultProtocol.registerSchemesAsPrivileged([
    {
      scheme: SANDBOX_PROTOCOL_SCHEME,
      privileges: {
        // Treat as if loaded from a real domain (gets cookies, ServiceWorker, etc.)
        // independently per appId since the URL host differs.
        standard: true,
        // Allow fetch / XHR / SSE.
        supportFetchAPI: true,
        // Each appId gets its own origin → independent localStorage / IDB.
        secure: true,
        // CSP: we set this from inside the shell HTML; don't disable web security.
        // bypassCSP: false (default)
        // codeCache speeds up repeat module loads.
        codeCache: true,
        // The protocol streams in our app data; CORS is handled by same-origin reads.
        corsEnabled: true,
        allowServiceWorkers: false,
      },
    },
  ]);
}

/**
 * Wires `protocol.handle('lumos-app', ...)` to forward requests through the
 * pure protocol-handler with our deps.
 */
export function registerSandboxProtocol(deps: SandboxProtocolDeps): () => void {
  const protocol = deps.protocol ?? defaultProtocol;
  const handler = makeProtocolHandler(deps);

  protocol.handle(SANDBOX_PROTOCOL_SCHEME, handler);
  return () => protocol.unhandle(SANDBOX_PROTOCOL_SCHEME);
}

/**
 * Builds the request handler. Exported separately for tests; production code
 * uses registerSandboxProtocol which wraps this.
 */
export function makeProtocolHandler(
  deps: Pick<SandboxProtocolDeps, 'appLoader' | 'runtimeAssets'>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const result = await handleProtocolRequest(
        { url: request.url },
        {
          loadApp: async (appId: string): Promise<LoadedApp | null> => {
            try {
              return await deps.appLoader.load(appId);
            } catch (err) {
              return errorAppPage(appId, err as Error);
            }
          },
          readRuntimeAsset: (name: string) => deps.runtimeAssets.read(name),
        },
      );

      const headers = new Headers();
      for (const [key, value] of Object.entries(result.headers)) {
        headers.set(key, value);
      }
      const body = typeof result.body === 'string'
        ? result.body
        : new Uint8Array(result.body).buffer;
      return new Response(body, { status: result.status, headers });
    } catch (err) {
      const e = err as Error;
      return new Response(
        `<!doctype html><pre>Lumos sandbox protocol error:\n${e.stack ?? e.message}</pre>`,
        { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
  };
}

/**
 * Wraps an AppLoader compile failure as a synthetic LoadedApp that renders
 * the error inside the iframe — instead of 404, we show what went wrong.
 */
function errorAppPage(appId: string, err: Error): LoadedApp {
  return {
    manifest: {
      id: appId,
      name: '加载失败',
      version: '0.0.0',
      entry: 'error',
      routes: [{ id: 'error', path: '/', page: 'pages/error.tsx' }],
      permissions: {},
      runtime: { engine: 'react-v2', react: '19' },
    },
    modules: [
      {
        path: 'pages/error.tsx',
        outputPath: '_app/pages/error.tsx.mjs',
        code: errorPageEsm(err.stack ?? err.message),
        hash: 'error',
        imports: [],
      },
    ],
  };
}

/** Hand-written ESM module — no compile step needed in the failure path. */
function errorPageEsm(stack: string): string {
  return `
import { jsx, jsxs } from 'react/jsx-runtime';
const STACK = ${JSON.stringify(stack)};
export default function ErrorPage() {
  return jsxs('div', {
    style: { padding: 24, font: '13px/1.5 ui-monospace, monospace', color: '#b91c1c', whiteSpace: 'pre-wrap' },
    children: [
      jsx('div', { style: { fontWeight: 600, marginBottom: 12 }, children: '应用加载失败' }),
      jsx('div', { children: STACK }),
    ],
  });
}
`;
}
