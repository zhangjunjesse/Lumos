import fs from 'fs';
import path from 'path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const SCHEMA_DIR = path.resolve(__dirname, '../../../../resources/app-schemas');

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
