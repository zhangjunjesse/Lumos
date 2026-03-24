import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'fs/promises';
const mockExecFileSync = jest.fn();
jest.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));
import { compileCodeCapability, executeCodeCapability } from '../executor';
import { capabilityStep } from '@/lib/workflow/steps/capabilityStep';

describe('capability executor', () => {
  const originalDataDir = process.env.LUMOS_DATA_DIR;
  let tempDataDir = '';

  beforeEach(async () => {
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'lumos-capability-test-'));
    process.env.LUMOS_DATA_DIR = tempDataDir;
    mockExecFileSync.mockReset();
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

  test('compiles and executes a typed TypeScript capability module', async () => {
    const capabilityId = `doc.convert_${Date.now()}`;
    const code = `
      type CapabilityInput = {
        sourcePath: string;
        targetFormat: string;
      };

      export async function execute(input: CapabilityInput): Promise<{ success: boolean; output: { summary: string; targetFormat: string } }> {
        return {
          success: true,
          output: {
            summary: input.sourcePath + ' -> ' + input.targetFormat,
            targetFormat: input.targetFormat,
          },
        };
      }
    `;

    await compileCodeCapability(capabilityId, code);
    const result = await executeCodeCapability(capabilityId, {
      sourcePath: './demo.docx',
      targetFormat: 'markdown',
    });

    expect(result).toMatchObject({
      success: true,
      output: {
        summary: './demo.docx -> markdown',
        targetFormat: 'markdown',
      },
    });
  });

  test('capability step exposes capability metadata for workflow runtime views', async () => {
    const capabilityId = `doc.summarize_${Date.now()}`;
    const code = `
      export async function execute(input) {
        return {
          success: true,
          output: {
            summary: 'done:' + input.name,
          },
        };
      }
    `;

    await compileCodeCapability(capabilityId, code);
    const result = await capabilityStep({
      capabilityId,
      input: { name: 'lumos' },
    });

    expect(result).toMatchObject({
      success: true,
      output: {
        summary: 'done:lumos',
      },
      metadata: {
        capabilityId,
        executionMode: 'published-capability',
      },
    });
  });

  test('falls back to weasyprint when md-converter pdf export is missing pdflatex', async () => {
    const code = `
      export async function execute() {
        return {
          success: false,
          output: {},
          error: 'pdflatex not found. Please select a different --pdf-engine or install pdflatex',
        };
      }
    `;

    await compileCodeCapability('md-converter', code);
    const result = await executeCodeCapability('md-converter', {
      mdContent: '# Claude 使用技巧报告',
      targetFormat: 'pdf',
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      filePath: expect.stringMatching(/\.pdf$/),
    });
    expect(mockExecFileSync).toHaveBeenNthCalledWith(1, 'pandoc', expect.arrayContaining(['-o', expect.stringMatching(/\.html$/)]), { stdio: 'pipe' });
    expect(mockExecFileSync).toHaveBeenNthCalledWith(2, 'weasyprint', expect.arrayContaining([expect.stringMatching(/\.html$/), expect.stringMatching(/\.pdf$/)]), { stdio: 'pipe' });
  });
});
