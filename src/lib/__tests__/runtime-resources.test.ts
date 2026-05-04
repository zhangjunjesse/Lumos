import fs from 'fs';
import os from 'os';
import path from 'path';

describe('runtime-resources', () => {
  const originalEnv = { ...process.env };
  let tempRoot: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-runtime-resources-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('prefers an explicit external resource root', async () => {
    const explicitRoot = path.join(tempRoot, 'explicit');
    const dataRoot = path.join(tempRoot, 'data');
    const relativePath = path.join('node-runtime', process.platform, process.arch, process.platform === 'win32' ? 'node.exe' : 'node');
    const explicitNode = path.join(explicitRoot, relativePath);
    const dataNode = path.join(dataRoot, 'runtime-resources', relativePath);

    fs.mkdirSync(path.dirname(explicitNode), { recursive: true });
    fs.mkdirSync(path.dirname(dataNode), { recursive: true });
    fs.writeFileSync(explicitNode, '');
    fs.writeFileSync(dataNode, '');

    process.env.LUMOS_EXTERNAL_RESOURCES_DIR = explicitRoot;
    process.env.LUMOS_DATA_DIR = dataRoot;

    const { resolveRuntimeResourcePath } = await import('../runtime-resources');
    expect(resolveRuntimeResourcePath(relativePath)).toBe(explicitNode);
  });

  it('falls back to the data-dir runtime resource cache', async () => {
    const dataRoot = path.join(tempRoot, 'data');
    const relativePath = path.join('models', 'Xenova', 'bge-small-zh-v1.5', 'config.json');
    const cachedModelConfig = path.join(dataRoot, 'runtime-resources', relativePath);

    fs.mkdirSync(path.dirname(cachedModelConfig), { recursive: true });
    fs.writeFileSync(cachedModelConfig, '{}');

    process.env.LUMOS_DATA_DIR = dataRoot;

    const { resolveRuntimeResourcePath } = await import('../runtime-resources');
    expect(resolveRuntimeResourcePath(relativePath)).toBe(cachedModelConfig);
  });
});
