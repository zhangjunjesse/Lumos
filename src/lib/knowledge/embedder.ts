/**
 * Local embedding — bge-small-zh-v1.5 via @huggingface/transformers
 * Ported from demo/local-server/services/knowledge/embedder.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// @ts-expect-error onnxruntime-web exports omit types for bundler resolution, but runtime import is valid.
import * as onnxruntimeWebRuntime from 'onnxruntime-web';
import { getDb } from '@/lib/db';

const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';
const DIMENSION = 512;

const MODEL_RESOURCE_SUBPATH = path.join('Xenova', 'bge-small-zh-v1.5');
const MODEL_CACHE_RELATIVE_DIR = path.join('runtime', 'embedding-models');
const REQUIRED_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  path.join('onnx', 'model_quantized.onnx'),
] as const;
const LOCAL_MODEL_NOT_FOUND_ERROR_FRAGMENT = 'file was not found locally at';

interface OnnxruntimeWebModule {
  env: {
    wasm: {
      wasmPaths?: string | { mjs?: string; wasm?: string };
      proxy?: boolean;
    };
  };
}

interface TransformersLikeEnv {
  backends?: {
    onnx?: OnnxruntimeWebModule['env'];
  };
  localModelPath?: string;
  allowRemoteModels?: boolean;
  allowLocalModels?: boolean;
  useCustomCache?: boolean;
  customCache?: {
    match(request: string | URL): Promise<Response | undefined>;
    put(request: string | URL, response: Response): Promise<void>;
  } | null;
  useBrowserCache?: boolean;
  useFSCache?: boolean;
}

const onnxruntimeWeb = onnxruntimeWebRuntime as OnnxruntimeWebModule;

let _pipelinePromise: Promise<unknown> | null = null;

const ONNXRUNTIME_WEB_DIST_CANDIDATES = [
  path.join('node_modules', 'onnxruntime-web', 'dist'),
  path.join('.next', 'node_modules', 'onnxruntime-web', 'dist'),
  path.join('.next', 'standalone', 'node_modules', 'onnxruntime-web', 'dist'),
  path.join('.next', 'standalone', '.next', 'node_modules', 'onnxruntime-web', 'dist'),
];
const ONNXRUNTIME_WEB_WASM_ENTRY = 'ort-wasm-simd-threaded.mjs';

const LOCAL_MODEL_ROOT_CANDIDATES = [
  path.join('resources', 'models'),
  'models',
  path.join('standalone', 'resources', 'models'),
  path.join('standalone', 'models'),
];

interface ModelFileInspection {
  relativePath: string;
  exists: boolean;
  size: number | null;
}

interface ModelRootInspection {
  modelRoot: string;
  baseDir: string;
  missing: string[];
  files: ModelFileInspection[];
}

interface PreparedLocalModel {
  cacheRoot: string;
  modelDir: string;
  sourceRoot: string;
  copiedToCache: boolean;
}

const PORTABLE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  json: 'application/json',
  txt: 'text/plain',
  onnx: 'application/octet-stream',
};

function addCandidateRoot(roots: Set<string>, root?: string | null): void {
  if (!root) {
    return;
  }

  const trimmed = root.trim();
  if (!trimmed) {
    return;
  }

  roots.add(path.resolve(trimmed));
}

function shouldUsePortableEmbeddingRuntime(): boolean {
  return process.env.LUMOS_FORCE_PORTABLE_EMBEDDER === '1';
}

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function resolvePortableEmbeddingDevice(): 'wasm' {
  return 'wasm';
}

function buildOnnxruntimeWebDistCandidates(): string[] {
  const roots = new Set<string>();

  addCandidateRoot(roots, process.cwd());
  addCandidateRoot(roots, process.env.INIT_CWD);
  addCandidateRoot(roots, process.resourcesPath);
  addCandidateRoot(roots, process.resourcesPath ? path.join(process.resourcesPath, 'standalone') : null);
  addCandidateRoot(roots, path.dirname(process.execPath));
  addCandidateRoot(roots, process.execPath ? path.join(path.dirname(process.execPath), '..', 'Resources') : null);

  const candidates = new Set<string>();
  for (const root of roots) {
    for (const relativePath of ONNXRUNTIME_WEB_DIST_CANDIDATES) {
      candidates.add(path.join(root, relativePath));
    }
  }

  return Array.from(candidates);
}

function resolveOnnxruntimeWebDir(): string {
  for (const candidate of buildOnnxruntimeWebDistCandidates()) {
    if (fs.existsSync(path.join(candidate, ONNXRUNTIME_WEB_WASM_ENTRY))) {
      return candidate;
    }
  }

  throw new Error(
    `onnxruntime-web dist not found; checked ${buildOnnxruntimeWebDistCandidates().join(', ')}`,
  );
}

function buildOnnxruntimeWebDiagnostics(): string {
  const requiredFiles = [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ];

  return buildOnnxruntimeWebDistCandidates()
    .map((candidate) => {
      const present = requiredFiles
        .map((file) => {
          const absolutePath = path.join(candidate, file);
          try {
            const stats = fs.statSync(absolutePath);
            return `${file}(${stats.size}B)`;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is string => Boolean(entry));
      const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(candidate, file)));
      return `${candidate} -> missing=[${missing.length ? missing.join(', ') : 'none'}] present=[${present.join(', ') || 'none'}]`;
    })
    .join(' | ');
}

function buildLocalModelRootCandidates(): string[] {
  const roots = new Set<string>();

  addCandidateRoot(roots, process.cwd());
  addCandidateRoot(roots, process.env.INIT_CWD);
  addCandidateRoot(roots, process.resourcesPath);
  addCandidateRoot(roots, path.dirname(process.execPath));
  addCandidateRoot(roots, process.execPath ? path.join(path.dirname(process.execPath), '..', 'Resources') : null);

  const candidates = new Set<string>();
  for (const root of roots) {
    for (const relativePath of LOCAL_MODEL_ROOT_CANDIDATES) {
      candidates.add(path.join(root, relativePath));
    }
  }

  return Array.from(candidates);
}

function getLocalModelCacheRoot(): string {
  return path.join(getConfiguredDataDir(), MODEL_CACHE_RELATIVE_DIR);
}

function inspectModelRoot(modelRoot: string): ModelRootInspection {
  const baseDir = path.join(modelRoot, MODEL_RESOURCE_SUBPATH);
  const files = REQUIRED_MODEL_FILES.map((relativePath) => {
    const absolutePath = path.join(baseDir, relativePath);
    try {
      const stats = fs.statSync(absolutePath);
      return { relativePath, exists: true, size: stats.size };
    } catch {
      return { relativePath, exists: false, size: null };
    }
  });

  return {
    modelRoot,
    baseDir,
    missing: files.filter((entry) => !entry.exists).map((entry) => entry.relativePath),
    files,
  };
}

function hasCompleteLocalModel(modelRoot: string): boolean {
  return inspectModelRoot(modelRoot).missing.length === 0;
}

function buildModelInspectionSummary(modelRoot: string): string {
  const inspection = inspectModelRoot(modelRoot);
  const present = inspection.files
    .filter((entry) => entry.exists)
    .map((entry) => `${entry.relativePath}(${entry.size}B)`)
    .join(', ');
  const missing = inspection.missing.length ? inspection.missing.join(', ') : 'none';
  return `${inspection.modelRoot} -> missing=[${missing}] present=[${present || 'none'}]`;
}

function buildModelDiagnostics(modelRoots: string[]): string {
  return Array.from(new Set(modelRoots)).map(buildModelInspectionSummary).join(' | ');
}

function copyModelIntoCache(sourceRoot: string, cacheRoot: string): void {
  const sourceDir = path.join(sourceRoot, MODEL_RESOURCE_SUBPATH);
  const targetDir = path.join(cacheRoot, MODEL_RESOURCE_SUBPATH);
  const stagingRoot = path.join(cacheRoot, `.staging-${process.pid}-${Date.now()}`);
  const stagingDir = path.join(stagingRoot, MODEL_RESOURCE_SUBPATH);

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stagingDir), { recursive: true });
  fs.cpSync(sourceDir, stagingDir, { recursive: true, force: true });

  if (!hasCompleteLocalModel(stagingRoot)) {
    throw new Error(
      `staged embedding model cache is incomplete; source=${sourceRoot}; staged=${buildModelInspectionSummary(stagingRoot)}`,
    );
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.renameSync(stagingDir, targetDir);
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

function prepareLocalModel(options?: { forceRefresh?: boolean }): PreparedLocalModel {
  const cacheRoot = getLocalModelCacheRoot();
  const sourceCandidates = buildLocalModelRootCandidates().filter((candidate) => {
    return path.resolve(candidate) !== path.resolve(cacheRoot);
  });

  if (!options?.forceRefresh && hasCompleteLocalModel(cacheRoot)) {
    return {
      cacheRoot,
      modelDir: path.join(cacheRoot, MODEL_RESOURCE_SUBPATH),
      sourceRoot: cacheRoot,
      copiedToCache: false,
    };
  }

  const sourceRoot = sourceCandidates.find((candidate) => hasCompleteLocalModel(candidate));
  if (!sourceRoot) {
    throw new Error(
      `local embedding model (${MODEL_NAME}) not found or incomplete; diagnostics: ${buildModelDiagnostics([
        cacheRoot,
        ...sourceCandidates,
      ])}`,
    );
  }

  copyModelIntoCache(sourceRoot, cacheRoot);

  if (!hasCompleteLocalModel(cacheRoot)) {
    throw new Error(
      `local embedding model cache refresh failed; source=${sourceRoot}; diagnostics: ${buildModelDiagnostics([
        cacheRoot,
        sourceRoot,
      ])}`,
    );
  }

  return {
    cacheRoot,
    modelDir: path.join(cacheRoot, MODEL_RESOURCE_SUBPATH),
    sourceRoot,
    copiedToCache: true,
  };
}

function shouldRetryModelLoad(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(LOCAL_MODEL_NOT_FOUND_ERROR_FRAGMENT);
}

function buildModelLoadError(error: unknown, preparedModel: PreparedLocalModel): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `embedding model initialization failed: ${message}; model diagnostics: ${buildModelDiagnostics([
      preparedModel.cacheRoot,
      preparedModel.sourceRoot,
      ...buildLocalModelRootCandidates(),
    ])}; onnxruntime-web diagnostics: ${buildOnnxruntimeWebDiagnostics()}`,
  );
}

function createPortableLocalModelCache() {
  const ephemeralEntries = new Map<string, Response>();

  function normalizePortableRequestPath(request: string | URL): string | null {
    let raw = request instanceof URL
      ? (request.protocol === 'file:' ? fileURLToPath(request) : request.toString())
      : String(request);

    if (/^(https?|blob):/i.test(raw)) {
      return null;
    }

    if (/^file:/i.test(raw)) {
      try {
        raw = fileURLToPath(raw);
      } catch {
        return null;
      }
    }

    if (process.platform === 'win32') {
      raw = raw.replace(/\//g, '\\');
    }

    return path.normalize(raw);
  }

  function buildLocalFileResponse(filePath: string): Response | undefined {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return undefined;
    }

    const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
    const headers = new Headers({
      'content-length': String(fs.statSync(filePath).size),
      'content-type': PORTABLE_CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream',
    });

    return new Response(fs.readFileSync(filePath), { status: 200, headers });
  }

  return {
    async match(request: string | URL): Promise<Response | undefined> {
      const normalized = normalizePortableRequestPath(request);
      if (normalized) {
        const fileResponse = buildLocalFileResponse(normalized);
        if (fileResponse) {
          return fileResponse;
        }
      }

      const cacheKey = request instanceof URL ? request.toString() : String(request);
      const cached = ephemeralEntries.get(cacheKey);
      return cached ? cached.clone() : undefined;
    },
    async put(request: string | URL, response: Response): Promise<void> {
      const cacheKey = request instanceof URL ? request.toString() : String(request);
      ephemeralEntries.set(cacheKey, response.clone());
    },
  };
}

function buildPortableWasmPaths(onnxruntimeWebDistDir: string): { mjs: string; wasm: string } {
  return {
    mjs: pathToFileURL(path.join(onnxruntimeWebDistDir, 'ort-wasm-simd-threaded.mjs')).href,
    wasm: pathToFileURL(path.join(onnxruntimeWebDistDir, 'ort-wasm-simd-threaded.wasm')).href,
  };
}

function configureOnnxruntimeWebEnv(env: OnnxruntimeWebModule['env'] | undefined, onnxruntimeWebDistDir: string): void {
  if (!env?.wasm) {
    return;
  }

  env.wasm.wasmPaths = buildPortableWasmPaths(onnxruntimeWebDistDir);
  env.wasm.proxy = false;
}

async function importPortableTransformersRuntime(): Promise<typeof import('@huggingface/transformers')> {
  const processReleaseNameDescriptor = process.release
    ? Object.getOwnPropertyDescriptor(process.release, 'name')
    : undefined;

  // `transformers.web.js` decides between `onnxruntime-node` and
  // `onnxruntime-web` at module evaluation time using
  // `process.release.name === "node"`. In Electron's server process that would
  // incorrectly select the ignored web-bundle stub for `onnxruntime-node`,
  // leaving `InferenceSession` undefined. Temporarily presenting this import as
  // a non-Node runtime makes the web build initialize its WASM backend.
  if (processReleaseNameDescriptor?.configurable) {
    Object.defineProperty(process.release, 'name', {
      ...processReleaseNameDescriptor,
      value: 'browser',
    });
  }

  try {
    const runtime = await import('./transformers-web-runtime');
    return runtime as typeof import('@huggingface/transformers');
  } finally {
    if (processReleaseNameDescriptor?.configurable) {
      Object.defineProperty(process.release, 'name', processReleaseNameDescriptor);
    }
  }
}

async function loadPortableTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const onnxruntimeWebDistDir = resolveOnnxruntimeWebDir();

  configureOnnxruntimeWebEnv(onnxruntimeWeb.env, onnxruntimeWebDistDir);

  const transformers = await importPortableTransformersRuntime();
  configureOnnxruntimeWebEnv(
    (transformers.env as TransformersLikeEnv).backends?.onnx,
    onnxruntimeWebDistDir,
  );

  return transformers;
}

function getExtractor(): Promise<unknown> {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const usePortableRuntime = shouldUsePortableEmbeddingRuntime();
      const transformers = usePortableRuntime
        ? await loadPortableTransformers()
        : await import('@huggingface/transformers');

      // Always load from bundled local weights — the app ships the quantized
      // bge-small-zh-v1.5 ONNX under the packaged resources. Before loading,
      // copy a complete model bundle into the app's writable data dir so
      // runtime indexing does not directly depend on the install directory
      // staying intact across Windows installer / updater edge cases.
      const transformersEnv = transformers.env as TransformersLikeEnv;
      let preparedModel = prepareLocalModel();
      transformersEnv.localModelPath = preparedModel.cacheRoot;
      transformersEnv.allowRemoteModels = false;
      transformersEnv.allowLocalModels = true;
      if (usePortableRuntime) {
        // `transformers.web.js` runs with `env.useFS=false`, so local model files
        // must be surfaced through a custom cache bridge backed by Node's fs.
        transformersEnv.useCustomCache = true;
        transformersEnv.customCache = createPortableLocalModelCache();
        transformersEnv.useBrowserCache = false;
        transformersEnv.useFSCache = false;
      }

      // 三条分支都用 q8 —— 打包产物里只带 `onnx/model_quantized.onnx` 这一份
      // 权重,之前第三条 fp16 纯属死代码暴露给 dev 模式的坑(next dev 独立 node
      // 子进程里 process.versions.electron 是 undefined,落到 fp16 分支找不到
      // model_fp16.onnx)。三路径统一跟磁盘权重对齐,不再分叉。
      const pipelineOptions: Record<string, unknown> = usePortableRuntime
        ? { device: resolvePortableEmbeddingDevice(), dtype: 'q8', local_files_only: true }
        : Boolean(process.versions.electron)
          ? { device: 'cpu', dtype: 'q8', local_files_only: true }
          : { dtype: 'q8', local_files_only: true };

      console.log('[embedding] Loading model:', MODEL_NAME, {
        portableRuntime: usePortableRuntime,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || null,
        runtime: usePortableRuntime ? 'transformers.web.js + onnxruntime-web' : '@huggingface/transformers',
        device: usePortableRuntime
          ? resolvePortableEmbeddingDevice()
          : (Boolean(process.versions.electron) ? 'cpu' : 'auto'),
        localModelRoot: preparedModel.cacheRoot,
        localModelDir: preparedModel.modelDir,
        modelSourceRoot: preparedModel.sourceRoot,
        copiedToCache: preparedModel.copiedToCache,
      });
      let p: unknown;
      try {
        p = await transformers.pipeline('feature-extraction', preparedModel.modelDir, pipelineOptions);
      } catch (error) {
        try {
          if (!shouldRetryModelLoad(error)) {
            throw error;
          }

          console.warn('[embedding] Initial local model load failed; refreshing cache and retrying once');
          preparedModel = prepareLocalModel({ forceRefresh: true });
          transformersEnv.localModelPath = preparedModel.cacheRoot;
          p = await transformers.pipeline('feature-extraction', preparedModel.modelDir, pipelineOptions);
        } catch (retryError) {
          throw buildModelLoadError(retryError, preparedModel);
        }
      }
      console.log('[embedding] Model loaded');
      return p;
    })().catch((error) => {
      _pipelinePromise = null;
      const enrichedError = error instanceof Error ? error : new Error(String(error));
      console.error('[embedding] Failed to initialize embedding runtime:', {
        model: MODEL_NAME,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || null,
        portableRuntime: shouldUsePortableEmbeddingRuntime(),
        message: enrichedError.message,
      });
      throw enrichedError;
    });
  }
  return _pipelinePromise;
}

/** Serialize Float32Array to Buffer for SQLite BLOB */
export function vectorToBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer);
}

/** Deserialize Buffer back to number[] */
export function bufferToVector(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

/** Batch embed texts (for indexing, no prefix) */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extractor = await getExtractor() as (text: string, opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
  const results: number[][] = [];
  for (const t of texts) {
    const out = await extractor(t, { pooling: 'cls', normalize: true });
    results.push(out.tolist()[0]);
  }
  return results;
}

/** Embed a query (adds "查询: " prefix for retrieval) */
export async function embedQuery(text: string): Promise<number[]> {
  const extractor = await getExtractor() as (text: string, opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
  const out = await extractor('查询: ' + text, { pooling: 'cls', normalize: true });
  return out.tolist()[0];
}

/** Index an item's chunks: generate embeddings and store in DB */
export async function indexItem(itemId: string, chunks: string[]) {
  if (!chunks.length) return;
  const vectors = await getEmbeddings(chunks);
  const db = getDb();
  const stmt = db.prepare('UPDATE kb_chunks SET embedding=? WHERE item_id=? AND chunk_index=?');
  const txn = db.transaction(() => {
    for (let i = 0; i < vectors.length; i++) {
      stmt.run(vectorToBuffer(vectors[i]), itemId, i);
    }
  });
  txn();
}

/** Remove embeddings for an item */
export function removeItemEmbeddings(itemId: string) {
  getDb().prepare('UPDATE kb_chunks SET embedding=NULL WHERE item_id=?').run(itemId);
}

export { DIMENSION, MODEL_NAME };
