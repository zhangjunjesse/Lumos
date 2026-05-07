import fs from 'fs';
import path from 'path';

import { type ToolDefinition, err, ok } from './types';

/**
 * Tool: read_schema(schema)
 *
 * Returns the full JSON Schema for one of the app-platform schemas, so
 * the agent can reference precise field constraints before generating a
 * file. The system prompt only embeds a summary; this tool fetches the
 * detailed shape on demand to keep the prompt small.
 *
 * Allowed schema names mirror resources/app-schemas/ filenames.
 */

const ALIAS_TO_FILE: Record<string, string> = {
  app: 'app.schema.json',
  routes: 'routes.schema.json',
  page: 'page.schema.json',
  'data-schema': 'data-schema.schema.json',
  'workflow-ref': 'workflow-ref.schema.json',
};

const SCHEMA_DIR =
  process.env.LUMOS_APP_SCHEMA_DIR && process.env.LUMOS_APP_SCHEMA_DIR.length > 0
    ? process.env.LUMOS_APP_SCHEMA_DIR
    : path.resolve(__dirname, '../../../../../resources/app-schemas');

const cache = new Map<string, Record<string, unknown>>();

export interface ReadSchemaInput {
  schema: 'app' | 'routes' | 'page' | 'data-schema' | 'workflow-ref';
}

export interface ReadSchemaOutput {
  schema: Record<string, unknown>;
  alias: string;
  filename: string;
}

export const readSchemaTool: ToolDefinition<ReadSchemaInput, ReadSchemaOutput> = {
  name: 'read_schema',
  description:
    'Return the full JSON Schema for one of the app-platform manifest files. Use this before emitting a file to ensure every field constraint is satisfied.',
  inputSchema: {
    type: 'object',
    required: ['schema'],
    additionalProperties: false,
    properties: {
      schema: {
        type: 'string',
        enum: Object.keys(ALIAS_TO_FILE),
      },
    },
  },
  async execute(input) {
    const filename = ALIAS_TO_FILE[input.schema];
    if (!filename) {
      return err('UnknownSchema', `Unknown schema alias '${input.schema}'`, {
        hint: `Valid aliases: ${Object.keys(ALIAS_TO_FILE).join(', ')}`,
      });
    }

    let cached = cache.get(input.schema);
    if (!cached) {
      try {
        const text = fs.readFileSync(path.join(SCHEMA_DIR, filename), 'utf-8');
        cached = JSON.parse(text) as Record<string, unknown>;
        cache.set(input.schema, cached);
      } catch (e) {
        return err('SchemaIOError', `Could not load ${filename}: ${(e as Error).message}`);
      }
    }

    return ok({ schema: cached, alias: input.schema, filename });
  },
};

/** Reset the in-process schema cache (used by tests after mutating SCHEMA_DIR). */
export function resetReadSchemaCache(): void {
  cache.clear();
}
