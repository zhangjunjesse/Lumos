import {
  buildCompiledWorkflowManifest,
  createWorkflowVersion,
  validateAnyWorkflowDsl,
} from './dsl';
import { validateCompiledWorkflowCode } from './compiler-helpers';
import { compileWorkflowDslV1 } from './compiler-v1';
import { compileWorkflowDslV2 } from './compiler-v2';
import type {
  AnyWorkflowDSL,
  GenerateWorkflowResult,
  WorkflowDSL,
  WorkflowDSLV2,
} from './types';

/**
 * Generate a compiled workflow from a v1 DSL spec.
 * Kept for backward compatibility — callers that only know about v1.
 */
export function generateWorkflow(input: { spec: WorkflowDSL }): GenerateWorkflowResult {
  return generateWorkflowFromDsl(input.spec);
}

/**
 * Unified entry point: accepts v1 or v2 DSL and produces compiled output.
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

  // Dispatch to version-specific compiler
  let result: GenerateWorkflowResult;
  if (spec.version === 'v2') {
    result = compileWorkflowDslV2(spec as WorkflowDSLV2);
  } else {
    const code = compileWorkflowDslV1(spec as WorkflowDSL);
    result = {
      code,
      manifest: buildCompiledWorkflowManifest(spec, createWorkflowVersion(spec)),
      validation: { valid: true, errors: [] },
    };
  }

  // Validate emitted code transpiles cleanly
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

/**
 * Compile a v1 DSL spec directly. Re-exported for callers that import
 * `compileWorkflowDsl` from compiler.ts.
 */
export { compileWorkflowDslV1 as compileWorkflowDsl } from './compiler-v1';
