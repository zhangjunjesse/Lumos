import os from 'os';
import path from 'path';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { listLegacyCapabilityFiles } from '../capabilities';

describe('legacy capability discovery', () => {
  const originalDataDir = process.env.LUMOS_DATA_DIR;
  let tempDataDir = '';

  beforeEach(async () => {
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'lumos-legacy-capability-'));
    process.env.LUMOS_DATA_DIR = tempDataDir;
    await mkdir(path.join(tempDataDir, 'capabilities'), { recursive: true });
  });

  afterEach(async () => {
    if (originalDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = originalDataDir;
    }

    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
    }
  });

  test('reads legacy code capability sidecar metadata from the capabilities directory', async () => {
    await writeFile(
      path.join(tempDataDir, 'capabilities', 'md-converter.ts'),
      [
        '// capability-id: md-converter',
        '// name: Markdown 文件转换器',
        '// description: 将 Markdown 文件转换为 Word、PDF、HTML 等格式',
        'export async function execute(input) {',
        '  return { success: true, output: { filePath: "/tmp/output.pdf" } };',
        '}',
      ].join('\n'),
      'utf-8',
    );

    await writeFile(
      path.join(tempDataDir, 'capabilities', 'md-converter.json'),
      JSON.stringify({
        id: 'md-converter',
        name: 'Markdown 文件转换器',
        description: '将 Markdown 文件转换为 Word、PDF 等多种格式',
        category: 'workflow',
        version: '1.0.0',
        inputs: [
          { name: 'mdContent', type: 'string', required: true },
          { name: 'targetFormat', type: 'string', required: true },
        ],
        outputs: [
          { name: 'filePath', type: 'string' },
        ],
      }),
      'utf-8',
    );

    const items = listLegacyCapabilityFiles();

    expect(items).toEqual([
      expect.objectContaining({
        id: 'md-converter',
        kind: 'code',
        name: 'Markdown 文件转换器',
        description: '将 Markdown 文件转换为 Word、PDF 等多种格式',
        version: '1.0.0',
        category: 'workflow',
        inputSchema: {
          mdContent: { type: 'string', required: true },
          targetFormat: { type: 'string', required: true },
        },
        outputSchema: {
          filePath: { type: 'string' },
        },
      }),
    ]);
  });
});
