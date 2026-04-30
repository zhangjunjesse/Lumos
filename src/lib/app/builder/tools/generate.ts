import { getValidators } from '../../manifest/ajv-instance';
import type { ValidationIssue } from '../../manifest/types';

import { type ToolDefinition, err, ok } from './types';

/**
 * Tools: generate_manifest / generate_routes / generate_page /
 *        generate_workflow / generate_data_schema
 *
 * Each tool takes the agent's proposed JSON and validates it against the
 * matching schema. On success, the validated value is returned (so the
 * agent can use the canonical form). On failure, detailed ValidationIssues
 * come back — the agent is expected to fix them and call again. The
 * agent runtime caps retries at 3 (per ai-builder design doc §9.2).
 *
 * These tools deliberately produce ONE file each. Cross-file references
 * are checked by validate_app on the full assembled package.
 */

interface GenerateInput {
  /** The proposed JSON value. */
  value: unknown;
}

function makeGenerator<T>(
  toolName: string,
  description: string,
  schemaKey: 'app' | 'routes' | 'page' | 'dataSchema' | 'workflowRef',
  fileLabel: string,
): ToolDefinition<GenerateInput, T> {
  return {
    name: toolName,
    description,
    inputSchema: {
      type: 'object',
      required: ['value'],
      additionalProperties: false,
      properties: {
        value: {
          description:
            'The proposed JSON value for this file. Use read_schema first to know the exact shape.',
        },
      },
    },
    async execute(input) {
      if (input == null || typeof input !== 'object' || !('value' in input)) {
        return err('BadInput', 'Tool input must be { "value": <json> }');
      }
      const validators = getValidators();
      const validate = validators[schemaKey];
      const valid = validate(input.value);
      if (!valid) {
        const issues: ValidationIssue[] = (validate.errors ?? []).map((e) => ({
          level: 'error',
          file: fileLabel,
          jsonPath: e.instancePath || '/',
          message: e.message ?? 'invalid',
          hint: e.params ? JSON.stringify(e.params) : undefined,
        }));
        return err(
          'SchemaInvalid',
          `${fileLabel} failed schema validation (${issues.length} issue${issues.length === 1 ? '' : 's'}). See issues for paths.`,
          {
            issues,
            hint: `Call read_schema('${schemaKey === 'dataSchema' ? 'data-schema' : schemaKey === 'workflowRef' ? 'workflow-ref' : schemaKey}') to see the full schema.`,
          },
        );
      }
      return ok(input.value as T);
    },
  };
}

export const generateManifestTool = makeGenerator<unknown>(
  'generate_manifest',
  'Validate and return a candidate app.json manifest. Returns SchemaInvalid with issues[] if the manifest violates app.schema.json — fix the issues and call again.',
  'app',
  'app.json',
);

export const generateRoutesTool = makeGenerator<unknown>(
  'generate_routes',
  'Validate and return a candidate routes.json. Reports schema issues with jsonPath so you can fix and retry.',
  'routes',
  'routes.json',
);

export const generatePageTool = makeGenerator<unknown>(
  'generate_page',
  'Validate and return a candidate pages/<id>.json. Layout-specific required fields (form/submit, list/detail, source/render, blocks) are checked.',
  'page',
  'pages/page.json',
);

export const generateWorkflowTool = makeGenerator<unknown>(
  'generate_workflow',
  'Validate and return a candidate workflows/<id>.json. The schema is intentionally permissive on engine-specific fields (nodes/edges/spec) — only id, name, description, inputs, outputs are validated by the app platform.',
  'workflowRef',
  'workflows/workflow.json',
);

export const generateDataSchemaTool = makeGenerator<unknown>(
  'generate_data_schema',
  'Validate and return a candidate data-schema.json. Each collection must have at least one field; enum fields require options; ref fields require a target collection name.',
  'dataSchema',
  'data-schema.json',
);
