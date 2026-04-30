import fs from 'fs';
import path from 'path';

import type {
  AppCategory,
  AppManifest,
  AppPage,
  AppRoutes,
  AppWorkflow,
  WorkflowInput,
  WorkflowOutput,
  ConfigItem,
  Trigger,
} from '../manifest/types';

/**
 * Workflow → App one-click conversion.
 *
 * Takes a lumos workflow document (engine-specific DSL is passed through
 * verbatim) plus user-supplied app metadata, and emits a complete
 * directory layout that `parseApp` + `validateApp` accept and `installApp`
 * can install. This is a deterministic transformation — no LLM involved.
 *
 * Mapping rules:
 *   workflow.name              → manifest.name
 *   workflow.description       → manifest.description
 *   workflow inputs            → pages/main.json form fields + workflow inputs
 *   workflow outputs[0]        → submit.render type (markdown / json / table /
 *                                 text), default 'markdown'
 *   workflow schedule (opts)   → manifest.triggers (one schedule trigger
 *                                 firing the same workflow id)
 *   detected MCPs (heuristic)  → manifest.requires.mcp + permissions:mcp
 *   detected tools (heuristic) → manifest.requires.tools + permissions:tool
 *
 * The promoter does NOT inspect engine-specific node bodies for behavioral
 * rewriting — it just copies them through. MCP / tool detection is a
 * surface scan: any string anywhere in the workflow body that matches
 * known mcp ids or tool names gets surfaced. The user can edit the
 * resulting manifest if the heuristic over- or under-counts.
 */

export interface SourceWorkflowInput {
  name: string;
  type: WorkflowInput['type'];
  label?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  description?: string;
}

export interface SourceWorkflowOutput {
  name: string;
  type: 'string' | 'markdown' | 'json' | 'table' | 'file';
  label?: string;
}

/**
 * What promoteWorkflowToApp accepts. Loose enough to fit any concrete DSL
 * version: the field names matter, not the engine semantics.
 */
export interface SourceWorkflow {
  /** App-friendly id; will become workflows/<id>.json. */
  id: string;
  name?: string;
  description?: string;
  inputs?: SourceWorkflowInput[];
  outputs?: SourceWorkflowOutput[];
  /** Anything else the engine needs (params, nodes, edges, spec, steps, …). */
  body?: Record<string, unknown>;
}

export interface PromoteRequest {
  /** App id; must be kebab-case 3-64 chars. */
  appId: string;
  appName: string;
  appVersion?: string; // default '0.1.0'
  appDescription?: string;
  category?: AppCategory;
  iconBuffer?: Buffer;
  /** When true, also write a schedule trigger built from `schedule`. */
  schedule?: { cron: string; input?: Record<string, unknown> };
  /** App-platform-known MCPs that the workflow needs (caller may augment heuristic). */
  extraMcps?: string[];
  /** Tools used (subset of bash/python/file/web-fetch). */
  extraTools?: Array<'bash' | 'python' | 'file' | 'web-fetch'>;
  /** Network domains that the workflow calls; without this, network is disabled. */
  networkDomains?: string[];
  workflow: SourceWorkflow;
  outDir: string; // where to write the app directory
}

export interface PromoteResult {
  rootPath: string;
  manifest: AppManifest;
  routes: AppRoutes;
  page: AppPage;
  appWorkflow: AppWorkflow;
}

const APP_ID_RE = /^[a-z][a-z0-9-]{2,63}$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;
const KNOWN_TOOLS = new Set<'bash' | 'python' | 'file' | 'web-fetch'>([
  'bash',
  'python',
  'file',
  'web-fetch',
]);

export function promoteWorkflowToApp(req: PromoteRequest): PromoteResult {
  if (!APP_ID_RE.test(req.appId)) {
    throw new Error(`Invalid app id: ${req.appId} (must match ${APP_ID_RE})`);
  }
  if (!ID_RE.test(req.workflow.id)) {
    throw new Error(`Invalid workflow id: ${req.workflow.id}`);
  }

  fs.mkdirSync(req.outDir, { recursive: true });
  fs.mkdirSync(path.join(req.outDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(req.outDir, 'workflows'), { recursive: true });

  const inputs = (req.workflow.inputs ?? []).map(normalizeInput);
  const outputs = (req.workflow.outputs ?? []).map(normalizeOutput);
  const renderType = pickRender(outputs);

  // ── workflows/<id>.json ─────────────────────────────────────────────
  const appWorkflow: AppWorkflow = {
    id: req.workflow.id,
    name: req.workflow.name,
    description: req.workflow.description,
    // Schema requires `version: 2` for legacy fixtures but treats it as
    // pass-through; we set 2 here purely for backward-compat with any
    // older consumers. Engine-specific body fields land alongside.
    version: 2,
    inputs,
    outputs,
    steps: [],
    ...(req.workflow.body ?? {}),
  };
  fs.writeFileSync(
    path.join(req.outDir, 'workflows', `${req.workflow.id}.json`),
    JSON.stringify(appWorkflow, null, 2),
  );

  // ── pages/main.json ─────────────────────────────────────────────────
  const formFields = inputs.map(inputToFormField);
  const page: AppPage = {
    title: req.appName,
    description: req.appDescription,
    layout: 'form',
    form: formFields,
    submit: {
      label: '运行',
      run: `workflow:${req.workflow.id}`,
      render: renderType,
    } as unknown as AppPage['submit'],
  };
  fs.writeFileSync(
    path.join(req.outDir, 'pages', 'main.json'),
    JSON.stringify(page, null, 2),
  );

  // ── routes.json ─────────────────────────────────────────────────────
  const routes: AppRoutes = {
    menu: [{ id: 'main', label: '运行', icon: 'play', page: 'pages/main.json' }],
    default: 'main',
  };
  fs.writeFileSync(
    path.join(req.outDir, 'routes.json'),
    JSON.stringify(routes, null, 2),
  );

  // ── icon.png ────────────────────────────────────────────────────────
  if (req.iconBuffer) {
    fs.writeFileSync(path.join(req.outDir, 'icon.png'), req.iconBuffer);
  } else {
    // Promoter ships a tiny placeholder so install-time icon-existence
    // check passes; user can replace later.
    fs.writeFileSync(path.join(req.outDir, 'icon.png'), Buffer.from('PNG_PLACEHOLDER'));
  }

  // ── permissions / requires (heuristic + caller hints) ───────────────
  const detected = detectMcpsAndTools(req.workflow);
  const allMcps = uniq([...(detected.mcps ?? []), ...(req.extraMcps ?? [])]).sort();
  const allTools = uniq<'bash' | 'python' | 'file' | 'web-fetch'>([
    ...detected.tools,
    ...(req.extraTools ?? []),
  ]).sort();
  const triggers: Trigger[] = req.schedule
    ? [
        { type: 'manual' },
        {
          type: 'schedule',
          cron: req.schedule.cron,
          workflow: req.workflow.id,
          input: req.schedule.input,
        },
      ]
    : [{ type: 'manual' }];

  const networkDomains = req.networkDomains ?? [];
  const config = inputsToSecretConfig(inputs);

  const manifest: AppManifest = {
    $schema: 'https://lumos.io/schemas/app.v1.json',
    id: req.appId,
    name: req.appName,
    version: req.appVersion ?? '0.1.0',
    description: req.appDescription,
    icon: './icon.png',
    category: req.category,
    entry: 'main',
    requires: {
      lumos: '>=1.0.0',
      ...(allMcps.length > 0 ? { mcp: allMcps } : {}),
      ...(allTools.length > 0 ? { tools: allTools } : {}),
      llm: 'chat',
    },
    permissions: {
      network:
        networkDomains.length > 0
          ? { mode: 'whitelist', domains: networkDomains }
          : { mode: 'disabled' },
      data: 'isolated',
    },
    ...(config.length > 0 ? { config } : {}),
    triggers,
  };
  fs.writeFileSync(
    path.join(req.outDir, 'app.json'),
    JSON.stringify(manifest, null, 2),
  );

  return { rootPath: req.outDir, manifest, routes, page, appWorkflow };
}

// ───── helpers ─────

function normalizeInput(raw: SourceWorkflowInput): WorkflowInput {
  return {
    name: raw.name,
    label: raw.label,
    type: raw.type,
    required: raw.required,
    default: raw.default,
    options: raw.options,
    description: raw.description,
  };
}

function normalizeOutput(raw: SourceWorkflowOutput): WorkflowOutput {
  return { name: raw.name, type: raw.type, label: raw.label };
}

function pickRender(outputs: WorkflowOutput[]): 'markdown' | 'json' | 'table' | 'text' {
  if (outputs.length === 0) return 'markdown';
  const first = outputs[0];
  switch (first.type) {
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'table':
      return 'table';
    case 'string':
    case 'file':
    default:
      return 'text';
  }
}

function inputToFormField(input: WorkflowInput): Record<string, unknown> {
  switch (input.type) {
    case 'text':
      return {
        type: 'textarea',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        default: input.default,
        description: input.description,
      };
    case 'select':
      return {
        type: 'select',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        default: input.default,
        options: input.options ?? [],
        description: input.description,
      };
    case 'boolean':
      return {
        type: 'switch',
        name: input.name,
        label: input.label ?? input.name,
        default: input.default,
        description: input.description,
      };
    case 'number':
      return {
        type: 'number',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        default: input.default,
        description: input.description,
      };
    case 'file':
      return {
        type: 'file',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        description: input.description,
      };
    case 'date':
      // Date isn't in the M1 widget set yet; degrade to text.
      return {
        type: 'text',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        default: input.default,
        description: 'YYYY-MM-DD',
      };
    case 'json':
      return {
        type: 'textarea',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        default:
          input.default !== undefined && input.default !== null
            ? typeof input.default === 'string'
              ? input.default
              : JSON.stringify(input.default, null, 2)
            : undefined,
        description: 'JSON 字符串',
        rows: 8,
      };
    case 'string':
    default:
      return {
        type: 'text',
        name: input.name,
        label: input.label ?? input.name,
        required: input.required,
        default: input.default,
        description: input.description,
      };
  }
}

/**
 * Inputs whose name implies a secret get exposed as a ConfigItem so users
 * can store the value once instead of typing it on every run. Heuristic
 * keyword list matches the names commonly used in workflow params.
 */
const SECRET_KEYWORDS = [/token/i, /key$/i, /secret/i, /password/i];

function inputsToSecretConfig(inputs: WorkflowInput[]): ConfigItem[] {
  return inputs
    .filter((i) => SECRET_KEYWORDS.some((re) => re.test(i.name)))
    .map<ConfigItem>((i) => ({
      key: i.name,
      label: i.label ?? i.name,
      type: 'secret',
      required: !!i.required,
      secret: true,
    }));
}

interface DetectedRefs {
  mcps: string[];
  tools: Array<'bash' | 'python' | 'file' | 'web-fetch'>;
}

/**
 * Surface scan for hints that the workflow uses certain MCP servers or
 * tool capabilities. The promoter offers these as DEFAULTS — if the
 * heuristic misses something, the user can edit the manifest.
 *
 * Heuristic:
 *   - "mcp:<id>" appearing as a substring  → mcps += <id>
 *   - "feishu" / "office-docs" / etc as substring → mcps += that
 *   - tool keywords ("bash", "python", "fetch") in the body → tools
 */
function detectMcpsAndTools(wf: SourceWorkflow): DetectedRefs {
  const mcps = new Set<string>();
  const tools = new Set<'bash' | 'python' | 'file' | 'web-fetch'>();

  const visited = new WeakSet<object>();
  function walk(value: unknown): void {
    if (typeof value === 'string') scanString(value);
    else if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === 'object') {
      if (visited.has(value as object)) return;
      visited.add(value as object);
      for (const v of Object.values(value as Record<string, unknown>)) walk(v);
    }
  }
  function scanString(s: string): void {
    const mcpRe = /(?:^|[\s,;])(?:mcp:|requires\.mcp:|server:?\s*['"]?)([a-z][a-z0-9-]{1,63})/gi;
    let m: RegExpExecArray | null;
    while ((m = mcpRe.exec(s)) !== null) mcps.add(m[1].toLowerCase());

    if (/\bbash\b/i.test(s)) tools.add('bash');
    if (/\bpython\b/i.test(s)) tools.add('python');
    if (/\bweb[_-]?fetch\b/i.test(s) || /\bfetch\(/.test(s)) tools.add('web-fetch');
    // 'file' tool is intentionally NOT auto-detected: too noisy.
  }

  walk(wf.body);
  // The body should also be scanned for known mcp tokens that don't follow
  // the prefix pattern — common provider names.
  const HEURISTIC_MCP_NAMES = ['feishu', 'office-docs', 'deepsearch', 'bilibili', 'douyin'];
  function scanForKnown(value: unknown): void {
    if (typeof value === 'string') {
      for (const name of HEURISTIC_MCP_NAMES) {
        if (value.toLowerCase().includes(name)) mcps.add(name);
      }
    } else if (Array.isArray(value)) {
      for (const v of value) scanForKnown(v);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) scanForKnown(v);
    }
  }
  scanForKnown(wf.body);

  return {
    mcps: Array.from(mcps),
    tools: Array.from(tools).filter((t) => KNOWN_TOOLS.has(t)),
  };
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
