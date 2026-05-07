import fs from 'fs';
import path from 'path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

// SCHEMA_DIR resolution priority:
//   1. LUMOS_APP_SCHEMA_DIR env var (used by the CLI script after bundling).
//   2. process.cwd()/resources/app-schemas for Next.js route handlers, where
//      bundling can rewrite __dirname to a virtual location such as /ROOT.
//   3. <__dirname>/../../../../resources/app-schemas for jest/source-tree use.
const SCHEMA_DIR = resolveSchemaDir();

export type Validators = {
  app: ValidateFunction;
  routes: ValidateFunction;
  page: ValidateFunction;
  dataSchema: ValidateFunction;
  workflowRef: ValidateFunction;
};

let cached: Validators | null = null;

export function getValidators(): Validators {
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const compile = (file: string): ValidateFunction => {
    const schemaText = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf-8');
    return ajv.compile(JSON.parse(schemaText));
  };
  cached = {
    app: compile('app.schema.json'),
    routes: compile('routes.schema.json'),
    page: compile('page.schema.json'),
    dataSchema: compile('data-schema.schema.json'),
    workflowRef: compile('workflow-ref.schema.json'),
  };
  return cached;
}

export function resetValidatorCache(): void {
  cached = null;
}

function resolveSchemaDir(): string {
  const candidates = [
    process.env.LUMOS_APP_SCHEMA_DIR,
    path.resolve(process.cwd(), 'resources/app-schemas'),
    path.resolve(__dirname, '../../../../resources/app-schemas'),
  ].filter((candidate): candidate is string => !!candidate && candidate.length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'app.schema.json'))) {
      return candidate;
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), 'resources/app-schemas');
}
