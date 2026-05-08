// Lumos App Runtime v2 — types for the React-in-iframe sandbox architecture.
// Replaces the declarative-v1 path that lived in src/lib/app/spec/.
// V1 still works (engine='declarative-v1'); v2 is engine='react-v2'.

export type RuntimeEngine = 'declarative-v1' | 'react-v2';

export type AppCategoryV2 =
  | 'office' | 'creative' | 'data' | 'communication'
  | 'research' | 'developer' | 'lifestyle' | 'other';

// ---- manifest.json (v2) -----------------------------------------------------

export interface ManifestV2 {
  $schema?: string;
  /** kebab-case unique id, 3-64 chars, must match ^[a-z][a-z0-9-]{2,63}$ */
  id: string;
  name: string;
  /** Semver, e.g. 0.1.0 */
  version: string;
  description?: string;
  /** Lucide icon name (e.g. 'Users'); rendered by the host shell. */
  icon?: string;
  category?: AppCategoryV2;
  /** Page id of the default landing route. Must match a route in `routes`. */
  entry: string;
  routes: ManifestRoute[];
  permissions: ManifestPermissions;
  config?: ManifestConfigItem[];
  runtime: ManifestRuntime;
}

export interface ManifestRoute {
  /** kebab-case stable id used by `nav.push(id)` */
  id: string;
  /** URL-style path. Static (`/customers`) or dynamic (`/customers/:id`). */
  path: string;
  /** Source file path within the app package, e.g. `pages/customers.tsx` */
  page: string;
  /** Sidebar label. Hidden routes (e.g. detail pages) can omit. */
  label?: string;
  /** Lucide icon name for the menu entry. */
  icon?: string;
  hidden?: boolean;
}

export interface ManifestPermissions {
  db?: { read?: string[]; write?: string[] };
  ai?: { complete?: boolean; stream?: boolean; structured?: boolean };
  workflow?: { run?: string[] };
  deepsearch?: { start?: boolean; read?: boolean; control?: boolean };
  network?: { mode: 'disabled' | 'whitelist'; domains?: string[] };
  secrets?: string[];
  system?: ('notification' | 'schedule' | 'clipboard' | 'im-notification')[];
  files?: { pick?: boolean; save?: boolean };
}

export interface ManifestConfigItem {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'secret';
  required?: boolean;
  default?: unknown;
  options?: string[];
  description?: string;
}

export interface ManifestRuntime {
  /** Always 'react-v2' for the new engine. */
  engine: 'react-v2';
  /** Pinned major React version. */
  react: '19';
  /**
   * Reserved for future opt-in runtime deps.
   * Current app iframe runtime exposes only the core importmap packages, so
   * generated apps should omit this or keep it empty.
   */
  deps?: ManifestRuntimeDep[];
  /** Whether to inject Tailwind utilities into the iframe. Default: true. */
  tailwind?: boolean;
}

export type ManifestRuntimeDep = never;

// ---- App package (in-memory representation) ---------------------------------

export type AppFile = {
  /** Path relative to app root, e.g. `pages/customers.tsx`. */
  path: string;
  content: string;
};

export interface AppPackageV2 {
  manifest: ManifestV2;
  /** Optional; when present, drives db.collection schema. */
  dataSchema?: unknown;
  /** All TSX/TS files in the package keyed by path. */
  sources: AppFile[];
}

// ---- Allowed file paths -----------------------------------------------------

/**
 * AI may write files matching these patterns. Host rejects anything else
 * (defence in depth — even though paths come from a trusted enum).
 */
export const ALLOWED_PATH_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /^manifest\.json$/,
  /^data-schema\.json$/,
  /^workflows\/[a-z][a-z0-9-]*\.json$/,
  /^pages\/[a-z][a-z0-9-]*(?:\.\[[a-z][a-z0-9-]*\])?\.tsx$/,
  /^components\/[a-z][a-z0-9-]*\.tsx$/,
  /^lib\/[a-z][a-z0-9-]*\.ts$/,
  /^styles\/[a-z][a-z0-9-]*\.css$/,
]);

export function isAllowedAppPath(path: string): boolean {
  return ALLOWED_PATH_PATTERNS.some((re) => re.test(path));
}

// ---- Compile result ---------------------------------------------------------

export interface CompiledModule {
  /** Source path, e.g. `pages/customers.tsx`. */
  path: string;
  /** Output path served from the iframe, e.g. `_app/pages/customers.tsx.mjs`. */
  outputPath: string;
  /** Compiled JS (ESM). */
  code: string;
  /** sha256 of source content. */
  hash: string;
  /** Bare imports the module declares (after stripping virtual modules). */
  imports: string[];
}

export interface CompileError {
  level: 'error' | 'warning';
  /** Source file the error is in. */
  file?: string;
  line?: number;
  column?: number;
  message: string;
  hint?: string;
}

export interface RuntimeCompileSuccess {
  ok: true;
  modules: CompiledModule[];
  warnings: CompileError[];
  /** Files that didn't need recompilation (cached). */
  fromCache: string[];
}

export interface RuntimeCompileFailure {
  ok: false;
  errors: CompileError[];
  warnings: CompileError[];
}

export type RuntimeCompileResult = RuntimeCompileSuccess | RuntimeCompileFailure;
