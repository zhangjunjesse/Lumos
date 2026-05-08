// Lumos AppSpec — high-level representation of a Lumos declarative app.
// AI authors this (as YAML); the compiler emits the 5 underlying JSON files.

export type AppCategory =
  | 'office' | 'creative' | 'data' | 'communication'
  | 'research' | 'developer' | 'lifestyle' | 'other';

export type AppNeed =
  | 'browser' | 'notification' | 'schedule' | 'clipboard' | 'im-notification'
  | `network:${string}` | `mcp:${string}` | `tool:${string}`
  | `llm:${string}` | `skill:${string}` | `team:${string}`
  | 'knowledge:required' | 'knowledge:optional';

export type AppMeta = {
  name: string;
  description?: string;
  category?: AppCategory;
  needs?: AppNeed[] | string[];
  fullscreen?: boolean;
};

export type FieldType =
  | 'text' | 'longtext' | 'int' | 'number' | 'bool'
  | 'date' | 'datetime' | 'enum' | 'ref';

export type FieldSpec = {
  type: FieldType;
  label?: string;
  required?: boolean;
  unique?: boolean;
  indexed?: boolean;
  primary?: boolean;
  default?: string | number | boolean | null;
  options?: string[];
  ref?: string;
  placeholder?: string;
  auto?: 'now' | 'uuid';
};

export type CollectionSpec = {
  label?: string;
  fields: Record<string, FieldSpec | string>;
};

export type ColumnSpec = {
  field: string;
  label?: string;
  render?: 'text' | 'tag' | 'badge' | 'date' | 'markdown' | 'link';
  sortable?: boolean;
  searchable?: boolean;
};

export type ActionSpec = {
  label: string;
  open?: string;
  run?: string;
  primary?: boolean;
  input?: Record<string, unknown>;
  confirm?: boolean | string;
};

export type SubmitSpec = {
  run: string;
  label?: string;
  input?: Record<string, unknown>;
  render?: 'markdown' | 'json' | 'table' | 'text' | 'none';
};

export type FormFieldSpec = {
  field: string;
  widget?: 'text' | 'textarea' | 'select' | 'number' | 'switch' | 'checkbox' | 'file';
  required?: boolean;
  placeholder?: string;
};

export type DetailTabSpec = {
  label: string;
  fields?: string[];
  table?: string;
};

export type ListPage = {
  title: string;
  description?: string;
  layout: 'list';
  data: string;
  columns?: (string | ColumnSpec)[];
  search?: string[];
  filter?: string[];
  actions?: ActionSpec[];
  rowActions?: ActionSpec[];
};

export type FormPage = {
  title: string;
  description?: string;
  layout: 'form';
  collection: string;
  fields?: (string | FormFieldSpec)[];
  submit?: string | SubmitSpec;
};

export type DetailPage = {
  title: string;
  description?: string;
  layout: 'detail';
  collection: string;
  tabs?: DetailTabSpec[];
  fields?: string[];
};

export type ResultPage = {
  title: string;
  description?: string;
  layout: 'result';
  source: string;
  input?: Record<string, unknown>;
  render: 'markdown' | 'json' | 'table' | 'text';
};

export type SinglePage = {
  title: string;
  description?: string;
  layout: 'single';
  blocks: BlockSpec[];
};

export type BlockSpec =
  | string
  | { markdown: string }
  | { card: { title?: string; children: BlockSpec[] } }
  | { table: { data: string; columns?: (string | ColumnSpec)[]; search?: string[]; filter?: string[]; actions?: ActionSpec[] } }
  | { button: { label: string; open?: string; run?: string; primary?: boolean; input?: Record<string, unknown>; confirm?: boolean | string } }
  | { link: { label: string; open: string } }
  | { tag: { value: string; color?: 'default' | 'primary' | 'success' | 'warning' | 'danger' } }
  | { badge: { value: string } };

export type PageSpec = ListPage | FormPage | DetailPage | SinglePage | ResultPage;

export type MenuEntry = string | { id: string; label?: string; icon?: string; hidden?: boolean };

export type WorkflowSpec = {
  name?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  steps?: unknown[];
} & Record<string, unknown>;

export type AppSpec = {
  app: AppMeta;
  menu?: MenuEntry[];
  default?: string;
  data?: Record<string, CollectionSpec>;
  pages?: Record<string, PageSpec>;
  workflows?: Record<string, WorkflowSpec>;
  seed?: Record<string, Record<string, unknown>[]>;
};

// Compile result — what the compiler returns to the runtime.

export type CompiledFile = { path: string; content: string };

export type CompileIssue = {
  level: 'error' | 'warning';
  loc?: { line?: number; column?: number; path: string[] };
  message: string;
  suggestion?: string;
};

export type CompileSuccess = {
  ok: true;
  files: CompiledFile[];
  warnings: CompileIssue[];
  summary: {
    appName: string;
    pageCount: number;
    collectionCount: number;
    workflowCount: number;
    seedRowCount: number;
  };
};

export type CompileFailure = {
  ok: false;
  errors: CompileIssue[];
  warnings: CompileIssue[];
};

export type CompileResult = CompileSuccess | CompileFailure;
