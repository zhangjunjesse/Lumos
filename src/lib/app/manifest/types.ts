// Lumos app platform — manifest types.
// Mirror of resources/app-schemas/*.schema.json. Keep in sync.

export type ValidationLevel = 'error' | 'warning';

export type ValidationIssue = {
  level: ValidationLevel;
  file: string;
  jsonPath: string;
  message: string;
  hint?: string;
};

// ---- app.json ----

export type AppCategory =
  | 'office'
  | 'creative'
  | 'data'
  | 'communication'
  | 'research'
  | 'developer'
  | 'lifestyle'
  | 'other';

export type AppToolName = 'bash' | 'python' | 'file' | 'web-fetch';
export type AppLlmTier = 'chat' | 'reasoning' | 'fast';
export type AppKnowledgeReq = 'required' | 'optional' | 'none';

export type AppRequires = {
  lumos?: string;
  mcp?: string[];
  tools?: AppToolName[];
  llm?: AppLlmTier;
  knowledge?: AppKnowledgeReq;
  agentTeams?: string[];
  browser?: boolean;
  skills?: string[];
};

export type AppPermissions = {
  filesystem?: { read?: string[]; write?: string[] };
  network?: { mode: 'disabled' | 'whitelist'; domains?: string[] };
  data?: 'isolated' | 'shared';
  system?: ('notification' | 'schedule' | 'clipboard')[];
};

export type ConfigItem = {
  key: string;
  label: string;
  type:
    | 'string'
    | 'textarea'
    | 'number'
    | 'boolean'
    | 'select'
    | 'secret'
    | 'file'
    | 'knowledge-collection';
  required?: boolean;
  secret?: boolean;
  default?: unknown;
  options?: { value: string | number | boolean; label: string }[];
  description?: string;
};

export type Trigger =
  | { type: 'manual' }
  | { type: 'schedule'; cron: string; workflow: string; input?: Record<string, unknown> }
  | { type: 'event'; event: string; workflow: string };

export type AppManifest = {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon: string;
  category?: AppCategory;
  tags?: string[];
  entry: string;
  requires?: AppRequires;
  permissions?: AppPermissions;
  config?: ConfigItem[];
  triggers?: Trigger[];
};

// ---- routes.json ----

export type MenuItem = {
  id: string;
  label: string;
  icon?: string;
  page?: string;
  component?: string;
  badge?: string;
  hidden?: boolean;
};

export type AppRoutes = {
  $schema?: string;
  menu: MenuItem[];
  default: string;
  fullscreen?: boolean;
};

// ---- pages/*.json ----

export type PageLayout = 'single' | 'form' | 'list-detail' | 'result';

export type AppPage = {
  $schema?: string;
  title: string;
  description?: string;
  layout: PageLayout;
  blocks?: unknown[];
  form?: unknown[];
  submit?: unknown;
  list?: unknown;
  detail?: unknown;
  source?: { run: string; input?: Record<string, unknown> };
  render?: 'markdown' | 'json' | 'table' | 'text';
};

// ---- data-schema.json ----

export type FieldType =
  | 'uuid'
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'json'
  | 'ref';

export type FieldDef = {
  name: string;
  type: FieldType;
  label?: string;
  primary?: boolean;
  required?: boolean;
  indexed?: boolean;
  unique?: boolean;
  default?: unknown;
  auto?: 'uuid' | 'now';
  options?: string[];
  ref?: string;
  description?: string;
};

export type Collection = {
  name: string;
  label?: string;
  fields: FieldDef[];
  indexes?: string[][];
};

export type AppDataSchema = {
  $schema?: string;
  collections: Collection[];
};

// ---- workflows/*.json (app-side reference contract) ----

export type WorkflowInput = {
  name: string;
  label?: string;
  type: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'file' | 'date' | 'json';
  required?: boolean;
  default?: unknown;
  options?: string[];
  description?: string;
};

export type WorkflowOutput = {
  name: string;
  type: 'string' | 'markdown' | 'json' | 'table' | 'file';
  label?: string;
};

export type AppWorkflow = {
  $schema?: string;
  id: string;
  name?: string;
  description?: string;
  version: 2;
  inputs?: WorkflowInput[];
  outputs?: WorkflowOutput[];
  steps: { id: string; type: string; [k: string]: unknown }[];
};

// ---- Parser output ----

export type ParsedApp = {
  manifest: AppManifest;
  routes: AppRoutes;
  /** key: relative path like "pages/customers.json" */
  pages: Map<string, AppPage>;
  /** key: workflow id (from doc.id) */
  workflows: Map<string, AppWorkflow>;
  dataSchema?: AppDataSchema;
  rootPath: string;
};

export type ParseResult =
  | { ok: true; app: ParsedApp; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };
