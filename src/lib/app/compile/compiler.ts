// React-in-iframe compiler. Takes the app's TSX/TS sources, outputs ESM modules
// the iframe can load via importmap. All `react` / `react-dom` / `@lumos/*`
// imports are kept as bare specifiers and resolved by an importmap on the
// iframe side (mapping to pre-bundled runtime modules served by the host).

import { transform, type Loader } from 'esbuild';
import { createHash } from 'node:crypto';

import type {
  AppFile, CompileError, CompiledModule, RuntimeCompileResult,
} from './types';
import { isAllowedAppPath } from './types';

/** Exact bare imports resolved by the iframe importmap. */
export const RUNTIME_EXTERNALS = Object.freeze([
  'react',
  'react-dom',
  '@lumos/app',
  '@lumos/ui',
  'lucide-react',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
]);

/** Prefix imports resolved by the iframe importmap. */
export const RUNTIME_EXTERNAL_PREFIXES = Object.freeze([
  'react/',
  'react-dom/',
]);

const PATH_TO_LOADER: Record<string, Loader> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.jsx': 'jsx',
  '.js': 'js',
  '.css': 'css',
};

interface CompileOptions {
  /** Stable id; used in cache keys / source map names. */
  appId: string;
  /** Per-file content cache. Caller maintains it across calls. */
  cache?: ModuleCache;
}

export type ModuleCache = Map<string, { hash: string; module: CompiledModule }>;

export function createModuleCache(): ModuleCache {
  return new Map();
}

export async function compileApp(
  files: AppFile[],
  opts: CompileOptions,
): Promise<RuntimeCompileResult> {
  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];
  const modules: CompiledModule[] = [];
  const fromCache: string[] = [];

  for (const file of files) {
    if (!isCompilable(file.path)) continue;

    if (!isAllowedAppPath(file.path)) {
      errors.push({
        level: 'error',
        file: file.path,
        message: `路径不在允许范围内：${file.path}。只允许 manifest.json / data-schema.json / workflows/*.json / pages/*.tsx / components/*.tsx / lib/*.ts / styles/*.css。`,
      });
      continue;
    }

    const hash = sha256(file.content);
    const cached = opts.cache?.get(file.path);
    if (cached && cached.hash === hash) {
      modules.push(cached.module);
      fromCache.push(file.path);
      continue;
    }

    const result = await compileOne(file, opts.appId);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    modules.push(result.module);
    opts.cache?.set(file.path, { hash, module: result.module });
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, modules, warnings, fromCache };
}

interface OneOk { ok: true; module: CompiledModule }
interface OneErr { ok: false; errors: CompileError[] }

async function compileOne(file: AppFile, appId: string): Promise<OneOk | OneErr> {
  const extMatch = file.path.match(/\.[a-z]+$/);
  const ext = extMatch?.[0] ?? '.tsx';
  const loader: Loader = PATH_TO_LOADER[ext] ?? 'tsx';

  if (loader === 'css') {
    // CSS files pass through as-is; iframe loads them via <link>.
    return {
      ok: true,
      module: {
        path: file.path,
        outputPath: `_app/${file.path}`,
        code: file.content,
        hash: sha256(file.content),
        imports: [],
      },
    };
  }

  try {
    const result = await transform(file.content, {
      loader,
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      jsxImportSource: 'react',
      sourcemap: 'inline',
      sourcefile: file.path,
      // Keep all bare imports as externals; iframe importmap resolves them.
      // esbuild's transform doesn't bundle, so externals are implicit — but we
      // still validate the imports below to keep the AI honest.
    });

    // Scan source (not output) — esbuild's transform DCE eliminates unused
    // imports, but we still want to reject blocked imports as a hard rule.
    const imports = extractBareImports(file.content);
    const blocked = imports.filter((imp) => !isExternalAllowed(imp));
    if (blocked.length > 0) {
      return {
        ok: false,
        errors: [{
          level: 'error',
          file: file.path,
          message: `不允许 import：${blocked.join(', ')}。当前应用运行时白名单：react / react-dom / @lumos/app / @lumos/ui / lucide-react / clsx / tailwind-merge / class-variance-authority。相对路径必须以 ./ 或 ../ 开头。`,
          hint: '图表、表单、状态管理等第三方包需要先打包进 app runtime 并加入 importmap，不能只写进 manifest.runtime.deps；禁止加载远程脚本。',
        }],
      };
    }

    const code = result.code;
    return {
      ok: true,
      module: {
        path: file.path,
        outputPath: `_app/${file.path}.mjs`,
        code,
        hash: sha256(file.content),
        imports,
      },
    };
  } catch (err) {
    const errors = parseEsbuildErrors(err, file.path);
    return { ok: false, errors };
  } finally {
    // appId currently unused but kept for cache namespacing.
    void appId;
  }
}

function isCompilable(path: string): boolean {
  return /\.(tsx|ts|jsx|js|css)$/.test(path);
}

function isExternalAllowed(spec: string): boolean {
  if (spec.startsWith('./') || spec.startsWith('../')) return true;
  if (RUNTIME_EXTERNALS.includes(spec)) return true;
  return RUNTIME_EXTERNAL_PREFIXES.some((prefix) =>
    spec.startsWith(prefix),
  );
}

function extractBareImports(code: string): string[] {
  const out = new Set<string>();
  const importRe = /\bimport\s+(?:[\w*{},\s]+from\s+)?["']([^"']+)["']/g;
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const exportRe = /\bexport\s+(?:[\w*{},\s]+\s+)?from\s+["']([^"']+)["']/g;
  for (const re of [importRe, dynamicRe, exportRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) out.add(m[1]);
  }
  return Array.from(out);
}

interface EsbuildLikeError {
  errors?: Array<{
    text: string;
    location?: { line: number; column: number; file?: string };
    notes?: { text: string }[];
  }>;
  message?: string;
}

function parseEsbuildErrors(err: unknown, fallbackFile: string): CompileError[] {
  const e = err as EsbuildLikeError;
  if (Array.isArray(e?.errors) && e.errors.length > 0) {
    return e.errors.map((info) => ({
      level: 'error' as const,
      file: info.location?.file ?? fallbackFile,
      line: info.location?.line,
      column: info.location?.column,
      message: info.text,
      ...(info.notes?.[0]?.text ? { hint: info.notes[0].text } : {}),
    }));
  }
  return [{
    level: 'error',
    file: fallbackFile,
    message: e?.message ?? '编译失败（未知原因）',
  }];
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}
