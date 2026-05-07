import fs from 'fs';
import path from 'path';

import type { ErrorObject } from 'ajv';

import { getValidators } from './ajv-instance';
import type {
  AppDataSchema,
  AppManifest,
  AppPage,
  AppRoutes,
  AppWorkflow,
  ParseResult,
  ValidationIssue,
} from './types';

function ajvErrorsToIssues(
  errors: ErrorObject[] | null | undefined,
  file: string,
): ValidationIssue[] {
  if (!errors) return [];
  return errors.map((e) => ({
    level: 'error' as const,
    file,
    jsonPath: e.instancePath || '/',
    message: e.message ?? 'invalid',
    hint: e.params ? JSON.stringify(e.params) : undefined,
  }));
}

function readJson<T>(filePath: string, file: string): { value: T } | { issue: ValidationIssue } {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return {
      issue: {
        level: 'error',
        file,
        jsonPath: '/',
        message: `Failed to read file: ${(err as Error).message}`,
      },
    };
  }
  try {
    return { value: JSON.parse(text) as T };
  } catch (err) {
    return {
      issue: {
        level: 'error',
        file,
        jsonPath: '/',
        message: `Invalid JSON: ${(err as Error).message}`,
      },
    };
  }
}

/**
 * Parse a Lumos app package directory.
 *
 * Reads app.json, routes.json, pages/*.json, workflows/*.json, data-schema.json.
 * Each file is validated against its JSON Schema (resources/app-schemas/).
 * Cross-file consistency is NOT checked here — see validateApp().
 */
export function parseApp(rootPath: string): ParseResult {
  const issues: ValidationIssue[] = [];
  const validators = getValidators();

  const appJsonPath = path.join(rootPath, 'app.json');
  if (!fs.existsSync(appJsonPath)) {
    return {
      ok: false,
      issues: [{ level: 'error', file: 'app.json', jsonPath: '/', message: 'app.json not found' }],
    };
  }
  const appRead = readJson<AppManifest>(appJsonPath, 'app.json');
  if ('issue' in appRead) return { ok: false, issues: [appRead.issue] };
  const manifest = appRead.value;
  if (!validators.app(manifest)) {
    return { ok: false, issues: ajvErrorsToIssues(validators.app.errors, 'app.json') };
  }

  const routesJsonPath = path.join(rootPath, 'routes.json');
  if (!fs.existsSync(routesJsonPath)) {
    return {
      ok: false,
      issues: [
        { level: 'error', file: 'routes.json', jsonPath: '/', message: 'routes.json not found' },
      ],
    };
  }
  const routesRead = readJson<AppRoutes>(routesJsonPath, 'routes.json');
  if ('issue' in routesRead) return { ok: false, issues: [routesRead.issue] };
  const routes = routesRead.value;
  if (!validators.routes(routes)) {
    return { ok: false, issues: ajvErrorsToIssues(validators.routes.errors, 'routes.json') };
  }

  const pages = new Map<string, AppPage>();
  const pagesDir = path.join(rootPath, 'pages');
  if (fs.existsSync(pagesDir)) {
    const entries = fs.readdirSync(pagesDir).sort();
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const pageRel = `pages/${file}`;
      const fullPath = path.join(pagesDir, file);
      const read = readJson<AppPage>(fullPath, pageRel);
      if ('issue' in read) {
        issues.push(read.issue);
        continue;
      }
      if (!validators.page(read.value)) {
        issues.push(...ajvErrorsToIssues(validators.page.errors, pageRel));
        continue;
      }
      pages.set(pageRel, read.value);
    }
  }

  const workflows = new Map<string, AppWorkflow>();
  const workflowsDir = path.join(rootPath, 'workflows');
  if (fs.existsSync(workflowsDir)) {
    const entries = fs.readdirSync(workflowsDir).sort();
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const wfRel = `workflows/${file}`;
      const fullPath = path.join(workflowsDir, file);
      const read = readJson<AppWorkflow>(fullPath, wfRel);
      if ('issue' in read) {
        issues.push(read.issue);
        continue;
      }
      if (!validators.workflowRef(read.value)) {
        issues.push(...ajvErrorsToIssues(validators.workflowRef.errors, wfRel));
        continue;
      }
      const wf = read.value;
      if (workflows.has(wf.id)) {
        issues.push({
          level: 'error',
          file: wfRel,
          jsonPath: '/id',
          message: `Duplicate workflow id: ${wf.id}`,
        });
        continue;
      }
      workflows.set(wf.id, wf);
    }
  }

  let dataSchema: AppDataSchema | undefined;
  const dataSchemaPath = path.join(rootPath, 'data-schema.json');
  if (fs.existsSync(dataSchemaPath)) {
    const read = readJson<AppDataSchema>(dataSchemaPath, 'data-schema.json');
    if ('issue' in read) {
      issues.push(read.issue);
    } else if (!validators.dataSchema(read.value)) {
      issues.push(...ajvErrorsToIssues(validators.dataSchema.errors, 'data-schema.json'));
    } else {
      dataSchema = read.value;
    }
  }

  if (issues.some((i) => i.level === 'error')) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    app: { manifest, routes, pages, workflows, dataSchema, rootPath },
    issues,
  };
}
