// Loads a "v2" app's manifest + compiled modules for the protocol handler.
//
// Two source kinds:
//   - 'builder:<sessionId>'   → reads from lumos_app_builder_artifacts (latest version per file)
//   - '<appId>'               → reads from installed app on disk (next session)
//
// Compilation uses the runtime/compiler.ts pipeline with per-app module cache.

import { compileApp, createModuleCache, type ModuleCache } from '@/lib/app/compile/compiler';
import type {
  AppFile, ManifestV2, CompiledModule, RuntimeCompileResult,
} from '@/lib/app/compile/types';
import type { LoadedApp } from './protocol-handler';
import { builderAppId, parseBuilderAppId } from './app-id';

// Re-export so existing imports from app-loader keep working.
export { builderAppId, parseBuilderAppId };

export interface AppSourceProvider {
  /** Returns the current source files for an appId, or null if the app doesn't exist. */
  loadSources(appId: string): Promise<AppFile[] | null>;
}

export interface AppLoaderOptions {
  source: AppSourceProvider;
}

interface CacheEntry {
  modules: CompiledModule[];
  manifest: ManifestV2;
  /** Hash of all source files combined; bust on any source change. */
  sourceFingerprint: string;
  cache: ModuleCache;
}

export class AppLoader {
  private source: AppSourceProvider;
  private appCache = new Map<string, CacheEntry>();

  constructor(opts: AppLoaderOptions) {
    this.source = opts.source;
  }

  async load(appId: string): Promise<LoadedApp | null> {
    const sources = await this.source.loadSources(appId);
    if (!sources || sources.length === 0) return null;

    const fingerprint = fingerprintSources(sources);
    const cached = this.appCache.get(appId);
    if (cached && cached.sourceFingerprint === fingerprint) {
      return { manifest: cached.manifest, modules: cached.modules };
    }

    const manifestFile = sources.find((f) => f.path === 'manifest.json');
    if (!manifestFile) {
      throw new AppLoaderError(`app ${appId} has no manifest.json`);
    }
    let manifest: ManifestV2;
    try {
      manifest = JSON.parse(manifestFile.content) as ManifestV2;
    } catch (err) {
      throw new AppLoaderError(`app ${appId} manifest.json is not valid JSON: ${(err as Error).message}`);
    }

    const moduleCache = cached?.cache ?? createModuleCache();
    const result: RuntimeCompileResult = await compileApp(sources, {
      appId,
      cache: moduleCache,
    });
    if (!result.ok) {
      const detail = result.errors.slice(0, 3)
        .map((e) => `${e.file ?? '?'}${e.line ? `:${e.line}` : ''} ${e.message}`)
        .join('\n');
      throw new AppLoaderError(`app ${appId} compile failed:\n${detail}`);
    }

    this.appCache.set(appId, {
      modules: result.modules,
      manifest,
      sourceFingerprint: fingerprint,
      cache: moduleCache,
    });
    return { manifest, modules: result.modules };
  }

  /** Force-reload next time. Useful when the source changes externally. */
  invalidate(appId: string): void {
    this.appCache.delete(appId);
  }

  /** Drop all caches (e.g. on app shutdown). */
  reset(): void {
    this.appCache.clear();
  }
}

export class AppLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppLoaderError';
  }
}

// ---- Source providers -----------------------------------------------------

/** Reads from lumos_app_builder_artifacts for a builder session. */
export class BuilderSessionSourceProvider implements AppSourceProvider {
  constructor(private deps: {
    listArtifacts: (sessionId: string) => Array<{ filePath: string; content: string }>;
  }) {}

  async loadSources(appId: string): Promise<AppFile[] | null> {
    const sessionId = parseBuilderAppId(appId);
    if (!sessionId) return null;
    const rows = this.deps.listArtifacts(sessionId);
    if (rows.length === 0) return null;
    return rows.map((r) => ({ path: r.filePath, content: r.content }));
  }
}

// ---- Helpers --------------------------------------------------------------

function fingerprintSources(files: AppFile[]): string {
  // Cheap: concatenate sorted (path, length, first/last char). Doesn't need
  // crypto strength — only needs to differ when any file changes.
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return sorted
    .map((f) => `${f.path}:${f.content.length}:${f.content.charCodeAt(0) || 0}:${f.content.charCodeAt(f.content.length - 1) || 0}`)
    .join('|');
}
