import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';

import { RuntimeAssetReader } from '../runtime-assets';

describe('RuntimeAssetReader', () => {
  let tmpDir: string;
  let reader: RuntimeAssetReader;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-runtime-'));
    reader = new RuntimeAssetReader({ rootDir: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('returns null for files outside whitelist', async () => {
    await fs.writeFile(path.join(tmpDir, 'evil.mjs'), 'export {}');
    expect(await reader.read('evil.mjs')).toBeNull();
  });

  test('reads a whitelisted file', async () => {
    await fs.writeFile(path.join(tmpDir, 'react.mjs'), 'export const r = 1');
    const asset = await reader.read('react.mjs');
    expect(asset).not.toBeNull();
    expect(asset!.contentType).toContain('text/javascript');
    expect(asset!.body.toString()).toBe('export const r = 1');
  });

  test('returns null for missing whitelisted file', async () => {
    expect(await reader.read('react.mjs')).toBeNull();
  });

  test('caches reads by mtime', async () => {
    const file = path.join(tmpDir, 'lumos-app.mjs');
    await fs.writeFile(file, 'v1');
    const a = await reader.read('lumos-app.mjs');
    expect(a!.body.toString()).toBe('v1');
    // Hit cache
    const b = await reader.read('lumos-app.mjs');
    expect(b).toBe(a);
  });

  test('content-type detection', async () => {
    await fs.writeFile(path.join(tmpDir, 'tailwind.css'), 'body{}');
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), '{}');
    const css = await reader.read('tailwind.css');
    const json = await reader.read('manifest.json');
    expect(css!.contentType).toContain('text/css');
    expect(json!.contentType).toContain('application/json');
  });
});
