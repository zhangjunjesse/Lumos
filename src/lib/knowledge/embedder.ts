/**
 * Local embedding — bge-small-zh-v1.5 via @huggingface/transformers
 * Ported from demo/local-server/services/knowledge/embedder.js
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as portableTransformersRuntime from './transformers-web-runtime';
import { getDb } from '@/lib/db';

const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';
const DIMENSION = 512;
const nodeRequire = createRequire(import.meta.url);

interface OnnxruntimeWebModule {
  env: {
    wasm: {
      wasmPaths?: string | { mjs?: string; wasm?: string };
      proxy?: boolean;
    };
  };
}

const onnxruntimeWeb = nodeRequire('onnxruntime-web') as OnnxruntimeWebModule;

let _pipelinePromise: Promise<unknown> | null = null;

function shouldUsePortableEmbeddingRuntime(): boolean {
  return Boolean(process.versions.electron) || process.env.LUMOS_FORCE_PORTABLE_EMBEDDER === '1';
}

function resolvePackageDir(specifier: string): string {
  const entry = nodeRequire.resolve(specifier);
  return path.resolve(path.dirname(entry), '..');
}

async function loadPortableTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const onnxruntimeWebDir = resolvePackageDir('onnxruntime-web');

  onnxruntimeWeb.env.wasm.wasmPaths = {
    mjs: pathToFileURL(path.join(onnxruntimeWebDir, 'dist', 'ort-wasm-simd-threaded.mjs')).href,
    wasm: pathToFileURL(path.join(onnxruntimeWebDir, 'dist', 'ort-wasm-simd-threaded.wasm')).href,
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
        : nodeRequire('@huggingface/transformers') as typeof import('@huggingface/transformers');

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
