import {
  handleProtocolRequest, parseAppUrl,
  type ProtocolContext, type LoadedApp,
} from '../protocol-handler';
import type { ManifestV2 } from '@/lib/app/compile/types';

function manifest(): ManifestV2 {
  return {
    id: 'demo-app',
    name: '示例',
    version: '0.1.0',
    entry: 'home',
    routes: [
      { id: 'home', path: '/', page: 'pages/index.tsx', label: '首页' },
    ],
    permissions: { db: { read: ['todos'] } },
    runtime: { engine: 'react-v2', react: '19' },
  };
}

function makeCtx(app: LoadedApp | null = null): ProtocolContext {
  return {
    loadApp: async (id) => (id === 'demo-app' ? app : null),
    readRuntimeAsset: async (name) => {
      if (name === 'tailwind.css') return { body: 'body{color:red}', contentType: 'text/css' };
      if (name === 'react.mjs') return { body: 'export default {}', contentType: 'text/javascript' };
      return null;
    },
  };
}

describe('parseAppUrl', () => {
  test('parses bare root', () => {
    expect(parseAppUrl('lumos-app://my-app')).toEqual({ appId: 'my-app', path: '' });
    expect(parseAppUrl('lumos-app://my-app/')).toEqual({ appId: 'my-app', path: '' });
  });
  test('parses asset paths', () => {
    expect(parseAppUrl('lumos-app://my-app/_app/pages/index.tsx.mjs')).toEqual({
      appId: 'my-app',
      path: '_app/pages/index.tsx.mjs',
    });
  });
  test('rejects bad app ids', () => {
    expect(parseAppUrl('lumos-app://AB/')).toBeNull();
    expect(parseAppUrl('lumos-app://my_app/')).toBeNull();
    expect(parseAppUrl('https://my-app/')).toBeNull();
  });
});

describe('handleProtocolRequest', () => {
  test('serves shell HTML for root', async () => {
    const ctx = makeCtx({
      manifest: manifest(),
      modules: [{ path: 'pages/index.tsx', outputPath: '_app/pages/index.tsx.mjs', code: 'export default () => null;', hash: 'h1', imports: [] }],
    });
    const res = await handleProtocolRequest({ url: 'lumos-app://demo-app/' }, ctx);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
    const body = String(res.body);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('importmap');
    expect(body).toContain('/_app/pages/index.tsx.mjs');
    expect(body).toContain('示例'); // app name in title
  });

  test('returns 404 for unknown app', async () => {
    const res = await handleProtocolRequest({ url: 'lumos-app://nope-app/' }, makeCtx());
    expect(res.status).toBe(404);
  });

  test('serves runtime asset', async () => {
    const res = await handleProtocolRequest({ url: 'lumos-app://demo-app/_runtime/tailwind.css' }, makeCtx({
      manifest: manifest(),
      modules: [],
    }));
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/css');
    expect(String(res.body)).toBe('body{color:red}');
  });

  test('serves compiled app module', async () => {
    const ctx = makeCtx({
      manifest: manifest(),
      modules: [{
        path: 'pages/index.tsx',
        outputPath: '_app/pages/index.tsx.mjs',
        code: 'export default () => "hi";',
        hash: 'abc123',
        imports: [],
      }],
    });
    const res = await handleProtocolRequest({ url: 'lumos-app://demo-app/_app/pages/index.tsx.mjs' }, ctx);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/javascript');
    expect(res.headers['X-Lumos-Hash']).toBe('abc123');
    expect(String(res.body)).toContain('export default');
  });

  test('serves extensionless relative module requests', async () => {
    const ctx = makeCtx({
      manifest: manifest(),
      modules: [
        { path: 'pages/index.tsx', outputPath: '_app/pages/index.tsx.mjs', code: 'import "../lib/markdown";', hash: 'page', imports: [] },
        { path: 'lib/markdown.ts', outputPath: '_app/lib/markdown.ts.mjs', code: 'export const ok = true;', hash: 'lib', imports: [] },
      ],
    });

    const res = await handleProtocolRequest({ url: 'lumos-app://demo-app/_app/lib/markdown' }, ctx);

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/javascript');
    expect(res.headers['X-Lumos-Hash']).toBe('lib');
    expect(String(res.body)).toContain('ok = true');
  });

  test('rejects path traversal', async () => {
    const ctx = makeCtx({ manifest: manifest(), modules: [] });
    const res = await handleProtocolRequest({ url: 'lumos-app://demo-app/_app/../../etc/passwd' }, ctx);
    expect(res.status).toBe(404);
  });

  test('returns 404 for unknown module', async () => {
    const ctx = makeCtx({
      manifest: manifest(),
      modules: [{ path: 'pages/index.tsx', outputPath: '_app/pages/index.tsx.mjs', code: '', hash: 'x', imports: [] }],
    });
    const res = await handleProtocolRequest({ url: 'lumos-app://demo-app/_app/pages/missing.tsx.mjs' }, ctx);
    expect(res.status).toBe(404);
  });
});
