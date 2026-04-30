import fs from 'fs';
import path from 'path';

import type { ParsedApp, ValidationIssue } from './types';

const WORKFLOW_REF_RE = /^workflow:([a-z][a-z0-9-]*)$/;
const PAGE_REF_RE = /^page:([a-z][a-z0-9-]*)$/;
const DB_REF_RE = /\{\{\s*db\.([a-z][a-z0-9_]*)\b/g;

const ICON_MAX_BYTES = 100 * 1024;

/**
 * Cross-file consistency check for a parsed app.
 *
 * Returns the set of issues that depend on relationships between files —
 * things JSON Schema alone cannot catch.
 */
export function validateApp(app: ParsedApp): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  checkIcon(app, issues);
  checkRoutes(app, issues);
  checkEntry(app, issues);
  checkPageReferences(app, issues);
  checkTriggers(app, issues);
  checkPermissionsV1(app, issues);
  checkMcpDeclared(app, issues);

  return issues;
}

function checkIcon(app: ParsedApp, issues: ValidationIssue[]): void {
  const iconRel = app.manifest.icon.replace(/^\.\//, '');
  const iconAbs = path.join(app.rootPath, iconRel);
  if (!fs.existsSync(iconAbs)) {
    issues.push({
      level: 'error',
      file: 'app.json',
      jsonPath: '/icon',
      message: `Icon file not found: ${app.manifest.icon}`,
    });
    return;
  }
  const stats = fs.statSync(iconAbs);
  if (stats.size > ICON_MAX_BYTES) {
    issues.push({
      level: 'warning',
      file: 'app.json',
      jsonPath: '/icon',
      message: `Icon file is ${stats.size} bytes; recommended max is ${ICON_MAX_BYTES}`,
    });
  }
}

function checkRoutes(app: ParsedApp, issues: ValidationIssue[]): void {
  const seenIds = new Set<string>();
  app.routes.menu.forEach((item, idx) => {
    if (seenIds.has(item.id)) {
      issues.push({
        level: 'error',
        file: 'routes.json',
        jsonPath: `/menu/${idx}/id`,
        message: `Duplicate menu id: ${item.id}`,
      });
    }
    seenIds.add(item.id);

    if (item.page) {
      if (!app.pages.has(item.page)) {
        issues.push({
          level: 'error',
          file: 'routes.json',
          jsonPath: `/menu/${idx}/page`,
          message: `Page not found: ${item.page}`,
          hint:
            app.pages.size === 0
              ? 'No pages defined.'
              : `Available: ${Array.from(app.pages.keys()).join(', ')}`,
        });
      }
    }

    if (item.component) {
      issues.push({
        level: 'error',
        file: 'routes.json',
        jsonPath: `/menu/${idx}/component`,
        message:
          'Code components are not supported in v1 of the app platform; use a declarative page instead.',
      });
    }
  });

  if (!seenIds.has(app.routes.default)) {
    issues.push({
      level: 'error',
      file: 'routes.json',
      jsonPath: '/default',
      message: `Default route '${app.routes.default}' is not in routes.menu`,
      hint: `Menu ids: ${Array.from(seenIds).join(', ')}`,
    });
  }
}

function checkEntry(app: ParsedApp, issues: ValidationIssue[]): void {
  const menuIds = new Set(app.routes.menu.map((m) => m.id));
  if (!menuIds.has(app.manifest.entry)) {
    issues.push({
      level: 'error',
      file: 'app.json',
      jsonPath: '/entry',
      message: `Entry '${app.manifest.entry}' is not in routes.menu`,
      hint: `Menu ids: ${Array.from(menuIds).join(', ')}`,
    });
  }
}

function checkPageReferences(app: ParsedApp, issues: ValidationIssue[]): void {
  const menuIds = new Set(app.routes.menu.map((m) => m.id));
  const collections = new Set(app.dataSchema?.collections.map((c) => c.name) ?? []);

  for (const [pageRel, page] of app.pages) {
    walkStrings(page, (s, jsonPath) => {
      const wfMatch = WORKFLOW_REF_RE.exec(s);
      if (wfMatch && !app.workflows.has(wfMatch[1])) {
        issues.push({
          level: 'error',
          file: pageRel,
          jsonPath,
          message: `Workflow not found: ${wfMatch[1]}`,
          hint:
            app.workflows.size === 0
              ? 'No workflows defined.'
              : `Available: ${Array.from(app.workflows.keys()).join(', ')}`,
        });
      }

      const pgMatch = PAGE_REF_RE.exec(s);
      if (pgMatch && !menuIds.has(pgMatch[1])) {
        issues.push({
          level: 'error',
          file: pageRel,
          jsonPath,
          message: `Page (menu id) not found: ${pgMatch[1]}`,
          hint: `Menu ids: ${Array.from(menuIds).join(', ')}`,
        });
      }

      const seenCollections = new Set<string>();
      let m: RegExpExecArray | null;
      const re = new RegExp(DB_REF_RE.source, DB_REF_RE.flags);
      while ((m = re.exec(s)) !== null) {
        const coll = m[1];
        if (seenCollections.has(coll)) continue;
        seenCollections.add(coll);
        if (!collections.has(coll)) {
          issues.push({
            level: 'error',
            file: pageRel,
            jsonPath,
            message: `db binding references unknown collection: ${coll}`,
            hint:
              collections.size === 0
                ? 'No data-schema.json defined.'
                : `Available: ${Array.from(collections).join(', ')}`,
          });
        }
      }
    });
  }
}

function checkTriggers(app: ParsedApp, issues: ValidationIssue[]): void {
  app.manifest.triggers?.forEach((t, idx) => {
    if (t.type === 'schedule' || t.type === 'event') {
      if (!app.workflows.has(t.workflow)) {
        issues.push({
          level: 'error',
          file: 'app.json',
          jsonPath: `/triggers/${idx}/workflow`,
          message: `Trigger references unknown workflow: ${t.workflow}`,
          hint:
            app.workflows.size === 0
              ? 'No workflows defined.'
              : `Available: ${Array.from(app.workflows.keys()).join(', ')}`,
        });
      }
    }
  });
}

function checkPermissionsV1(app: ParsedApp, issues: ValidationIssue[]): void {
  if (app.manifest.permissions?.data === 'shared') {
    issues.push({
      level: 'error',
      file: 'app.json',
      jsonPath: '/permissions/data',
      message:
        "permissions.data 'shared' is reserved for v3+; v1 must use 'isolated' (or omit).",
    });
  }
}

function checkMcpDeclared(app: ParsedApp, issues: ValidationIssue[]): void {
  // Warn if a declared MCP is never referenced in any workflow step body.
  // Since the workflow DSL is owned by src/lib/workflow/, we do a string scan
  // (workflow steps are passthrough JSON in the app-side schema).
  const declared = new Set(app.manifest.requires?.mcp ?? []);
  if (declared.size === 0) return;

  const used = new Set<string>();
  for (const wf of app.workflows.values()) {
    walkStrings(wf, (s) => {
      for (const id of declared) {
        if (s.includes(id)) used.add(id);
      }
    });
  }
  for (const id of declared) {
    if (!used.has(id)) {
      issues.push({
        level: 'warning',
        file: 'app.json',
        jsonPath: '/requires/mcp',
        message: `MCP '${id}' is declared but appears unused in any workflow.`,
      });
    }
  }
}

/** Walk every string in a JSON-shaped value, calling cb(value, jsonPath). */
function walkStrings(
  obj: unknown,
  cb: (s: string, jsonPath: string) => void,
  jsonPath = '',
): void {
  if (typeof obj === 'string') {
    cb(obj, jsonPath || '/');
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkStrings(v, cb, `${jsonPath}/${i}`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      walkStrings(v, cb, `${jsonPath}/${k}`);
    }
  }
}
