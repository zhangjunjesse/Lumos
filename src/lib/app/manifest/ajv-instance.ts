import fs from 'fs';
import path from 'path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

// SCHEMA_DIR resolution priority:
//   1. LUMOS_APP_SCHEMA_DIR env var (used by the CLI script after bundling
//      with esbuild, where __dirname no longer points at the source tree).
//   2. <__dirname>/../../../../resources/app-schemas — the in-tree path
//      that works for jest, Next.js, and Electron-packaged builds.
const SCHEMA_DIR =
  process.env.LUMOS_APP_SCHEMA_DIR && process.env.LUMOS_APP_SCHEMA_DIR.length > 0
    ? process.env.LUMOS_APP_SCHEMA_DIR
    : path.resolve(__dirname, '../../../../resources/app-schemas');

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
