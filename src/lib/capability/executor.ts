import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import ts from 'typescript';
import type { StepResult } from '@/lib/workflow/types';

const compiledCapabilitiesCache = new Map<string, (input: unknown) => Promise<StepResult>>();
const requireCapabilityModule = createRequire(__filename);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function attemptMarkdownPdfFallback(input: unknown): Promise<StepResult | null> {
  if (!isRecord(input) || input.targetFormat !== 'pdf' || typeof input.mdContent !== 'string') {
    return null;
  }

  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  const tempDir = path.join(dataDir, 'temp', 'capabilities', 'md-converter-fallback');
  await mkdir(tempDir, { recursive: true });

  const inputFile = existsSync(input.mdContent)
    ? input.mdContent
    : path.join(tempDir, `${randomUUID()}.md`);

  if (!existsSync(inputFile)) {
    await writeFile(inputFile, input.mdContent, 'utf-8');
  }

  const htmlPath = path.join(tempDir, `${randomUUID()}.html`);
  const requestedOutputPath = typeof input.outputPath === 'string' && input.outputPath.trim()
    ? input.outputPath.trim()
    : path.join(tempDir, `${randomUUID()}.pdf`);

  await mkdir(path.dirname(requestedOutputPath), { recursive: true });

  try {
    execFileSync('pandoc', [inputFile, '-o', htmlPath], { stdio: 'pipe' });
    execFileSync('weasyprint', [htmlPath, requestedOutputPath], { stdio: 'pipe' });
    return {
      success: true,
      output: {
        filePath: requestedOutputPath,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'PDF fallback conversion failed',
    };
  }
}

export async function compileCodeCapability(id: string, code: string): Promise<void> {
  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  const tempDir = path.join(dataDir, 'temp', 'capabilities');
  await mkdir(tempDir, { recursive: true });

  const tempFile = path.join(tempDir, `${id}-${randomUUID()}.cjs`);

  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
    fileName: `${id}.ts`,
  });

  const diagnostics = (transpiled.diagnostics || [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

  if (diagnostics.length > 0) {
    throw new Error(`Capability ${id} TypeScript compile failed: ${diagnostics.join('; ')}`);
  }

  await writeFile(tempFile, transpiled.outputText, 'utf-8');

  try {
    const resolvedPath = requireCapabilityModule.resolve(tempFile);
    delete requireCapabilityModule.cache[resolvedPath];

    const module = requireCapabilityModule(tempFile) as {
      default?: (input: unknown) => Promise<StepResult>;
      execute?: (input: unknown) => Promise<StepResult>;
    };
    const executeFunc = module.default || module.execute;

    if (typeof executeFunc !== 'function') {
      throw new Error(`Capability ${id} must export an 'execute' function`);
    }

    compiledCapabilitiesCache.set(id, executeFunc);
  } catch (error) {
    throw new Error(`Failed to compile capability ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function executeCodeCapability(id: string, input: unknown): Promise<StepResult> {
  const func = compiledCapabilitiesCache.get(id);
  if (!func) {
    throw new Error(`Capability ${id} not compiled. Available: ${Array.from(compiledCapabilitiesCache.keys()).join(', ')}`);
  }

  try {
    const result = await func(input);

    if (
      id === 'md-converter'
      && !result.success
      && typeof result.error === 'string'
      && /pdflatex not found/i.test(result.error)
    ) {
      const fallbackResult = await attemptMarkdownPdfFallback(input);
      if (fallbackResult?.success) {
        return fallbackResult;
      }
    }

    return result;
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Execution failed'
    };
  }
}
