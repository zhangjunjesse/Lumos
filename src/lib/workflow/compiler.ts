import {
  buildCompiledWorkflowManifest,
  createWorkflowVersion,
  validateAnyWorkflowDsl,
} from './dsl';
import { validateCompiledWorkflowCode } from './compiler-helpers';
import { compileWorkflowDslV3 } from './compiler-v3';
import type {
  AnyWorkflowDSL,
  GenerateWorkflowResult,
} from './types';

/**
 * Compile a workflow DSL to a runnable factory module.
 * All workflows are V3; the version field is kept on the DSL for forward compat.
 */
export function generateWorkflowFromDsl(spec: AnyWorkflowDSL): GenerateWorkflowResult {
  const validation = validateAnyWorkflowDsl(spec);
  const fallbackVersion = validation.valid
    ? createWorkflowVersion(spec)
    : `dsl-${spec.version}-invalid`;

  if (!validation.valid) {
    return {
      code: '',
      manifest: buildCompiledWorkflowManifest(spec, fallbackVersion),
      validation,
    };
  }

  const result = compileWorkflowDslV3(spec);

  if (result.code) {
    const codeErrors = validateCompiledWorkflowCode(result.code);
    if (codeErrors.length > 0) {
      return {
        ...result,
        validation: {
          valid: false,
          errors: [...result.validation.errors, ...codeErrors],
        },
      };
    }
  }

  return result;
}
