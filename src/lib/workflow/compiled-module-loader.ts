import type { WorkflowFactoryModule } from './types';

export interface CompiledWorkflowModuleLoaderDependencies {
  importModule?: (specifier: string) => Promise<WorkflowFactoryModule & Record<string, unknown>>;
  requireModule?: NodeJS.Require | null;
}

export async function loadCompiledWorkflowModule(
  moduleUrl: string,
  filePath: string,
  dependencies: CompiledWorkflowModuleLoaderDependencies = {},
): Promise<WorkflowFactoryModule & Record<string, unknown>> {
  // Create import function at runtime to avoid webpack static analysis
  const importModule = dependencies.importModule ?? new Function('s', 'return import(s)') as (s: string) => Promise<WorkflowFactoryModule & Record<string, unknown>>;
  const requireModule = dependencies.requireModule ?? (typeof require === 'function' ? require : null);

  try {
    return await importModule(moduleUrl);
  } catch (error) {
    const errorCode = (error as { code?: unknown } | null)?.code;
    if (requireModule && errorCode === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG') {
      const resolvedPath = requireModule.resolve(filePath);
      delete requireModule.cache[resolvedPath];
      return requireModule(filePath) as WorkflowFactoryModule & Record<string, unknown>;
    }
    throw error;
  }
}
