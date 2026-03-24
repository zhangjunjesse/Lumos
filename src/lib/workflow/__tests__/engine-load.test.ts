import type { WorkflowFactoryModule } from '../types';

function createRequireStub(returnValue: WorkflowFactoryModule & Record<string, unknown>, resolvedPath: string) {
  return Object.assign(
    jest.fn((_specifier: string) => returnValue),
    {
      resolve: jest.fn((_specifier: string) => resolvedPath),
      cache: {
        [resolvedPath]: { exports: returnValue },
      } as Record<string, { exports: WorkflowFactoryModule & Record<string, unknown> }>,
      extensions: {},
      main: undefined,
    },
  ) as unknown as NodeJS.Require;
}

describe('workflow engine compiled module loading', () => {
  test('returns native dynamic import result when available', async () => {
    const expectedModule = {
      buildWorkflow: jest.fn(),
      extra: 'native-import',
    } satisfies WorkflowFactoryModule & Record<string, unknown>;
    const importModule = jest.fn().mockResolvedValue(expectedModule);
    const requireModule = createRequireStub(expectedModule, '/tmp/native-import.cjs');

    const { loadCompiledWorkflowModule } = await import('../compiled-module-loader');
    const result = await loadCompiledWorkflowModule(
      'file:///tmp/native-import.mjs',
      '/tmp/native-import.mjs',
      {
        importModule,
        requireModule,
      },
    );

    expect(result).toBe(expectedModule);
    expect(importModule).toHaveBeenCalledWith('file:///tmp/native-import.mjs');
    expect(requireModule).not.toHaveBeenCalled();
  });

  test('falls back to require when Jest-style CJS runtime blocks dynamic import', async () => {
    const expectedModule = {
      buildWorkflow: jest.fn(),
      extra: 'require-fallback',
    } satisfies WorkflowFactoryModule & Record<string, unknown>;
    const importFailure = Object.assign(new Error('dynamic import unavailable'), {
      code: 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG',
    });
    const importModule = jest.fn().mockRejectedValue(importFailure);
    const resolvedPath = '/tmp/engine-load-fallback.cjs';
    const requireModule = createRequireStub(expectedModule, resolvedPath);

    const { loadCompiledWorkflowModule } = await import('../compiled-module-loader');
    const result = await loadCompiledWorkflowModule(
      'file:///tmp/engine-load-fallback.mjs',
      '/tmp/engine-load-fallback.mjs',
      {
        importModule,
        requireModule,
      },
    );

    expect(result).toBe(expectedModule);
    expect(importModule).toHaveBeenCalledWith('file:///tmp/engine-load-fallback.mjs');
    expect(requireModule.resolve).toHaveBeenCalledWith('/tmp/engine-load-fallback.mjs');
    expect(requireModule).toHaveBeenCalledWith('/tmp/engine-load-fallback.mjs');
    expect(requireModule.cache[resolvedPath]).toBeUndefined();
  });

  test('rethrows unrelated import failures', async () => {
    const importFailure = new Error('unexpected import failure');
    const importModule = jest.fn().mockRejectedValue(importFailure);
    const requireModule = createRequireStub(
      {
        buildWorkflow: jest.fn(),
      },
      '/tmp/unexpected-import-failure.cjs',
    );

    const { loadCompiledWorkflowModule } = await import('../compiled-module-loader');

    await expect(loadCompiledWorkflowModule(
      'file:///tmp/unexpected-import-failure.mjs',
      '/tmp/unexpected-import-failure.mjs',
      {
        importModule,
        requireModule,
      },
    )).rejects.toThrow('unexpected import failure');
    expect(requireModule).not.toHaveBeenCalled();
  });
});
