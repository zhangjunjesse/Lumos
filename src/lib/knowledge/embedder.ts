/**
 * Local embedding — bge-small-zh-v1.5 via @huggingface/transformers
 * Ported from demo/local-server/services/knowledge/embedder.js
 */
import { getDb } from '@/lib/db';

const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';
const DIMENSION = 512;

let _pipelinePromise: Promise<unknown> | null = null;

function getExtractor(): Promise<unknown> {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const transformers = await import('@huggingface/transformers');
      (transformers.env as Record<string, unknown>).remoteHost = 'https://hf-mirror.com/';
      console.log('[embedding] Loading model:', MODEL_NAME);
      const p = await transformers.pipeline('feature-extraction', MODEL_NAME, { dtype: 'fp16' } as Record<string, unknown>);
      console.log('[embedding] Model loaded');
      return p;
    })();
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
