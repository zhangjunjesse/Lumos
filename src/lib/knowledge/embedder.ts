/**
 * Local embedding — bge-small-zh-v1.5 via @huggingface/transformers
 * Ported from demo/local-server/services/knowledge/embedder.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error onnxruntime-web exports omit types for bundler resolution, but runtime import is valid.
import * as onnxruntimeWebRuntime from 'onnxruntime-web';
import * as portableTransformersRuntime from './transformers-web-runtime';
import { getDb } from '@/lib/db';

const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';
const DIMENSION = 512;

interface OnnxruntimeWebModule {
  env: {
    wasm: {
      wasmPaths?: string | { mjs?: string; wasm?: string };
      proxy?: boolean;
    };
  };
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
  return Boolean(process.versions.electron) || process.env.LUMOS_FORCE_PORTABLE_EMBEDDER === '1';
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

async function loadPortableTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const onnxruntimeWebDistDir = resolveOnnxruntimeWebDir();

  onnxruntimeWeb.env.wasm.wasmPaths = {
    mjs: pathToFileURL(path.join(onnxruntimeWebDistDir, 'ort-wasm-simd-threaded.mjs')).href,
    wasm: pathToFileURL(path.join(onnxruntimeWebDistDir, 'ort-wasm-simd-threaded.wasm')).href,
  };
  onnxruntimeWeb.env.wasm.proxy = false;

  return portableTransformersRuntime as typeof import('@huggingface/transformers');
}

function getExtractor(): Promise<unknown> {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const usePortableRuntime = shouldUsePortableEmbeddingRuntime();
      const transformers = usePortableRuntime
        ? await loadPortableTransformers()
        : await import('@huggingface/transformers');

      (transformers.env as Record<string, unknown>).remoteHost = 'https://hf-mirror.com/';
      const pipelineOptions: Record<string, unknown> = usePortableRuntime
        ? { device: 'wasm', dtype: 'q8' }
        : { dtype: 'fp16' };

      console.log('[embedding] Loading model:', MODEL_NAME, {
        portableRuntime: usePortableRuntime,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || null,
        runtime: usePortableRuntime ? 'transformers.web.js + onnxruntime-web' : '@huggingface/transformers',
      });
      const p = await transformers.pipeline('feature-extraction', MODEL_NAME, pipelineOptions);
      console.log('[embedding] Model loaded');
      return p;
    })().catch((error) => {
      _pipelinePromise = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[embedding] Failed to initialize embedding runtime:', {
        model: MODEL_NAME,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || null,
        portableRuntime: shouldUsePortableEmbeddingRuntime(),
        message,
      });
      throw error;
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
