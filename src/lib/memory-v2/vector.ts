import {
  bufferToVector,
  embedQuery,
  getEmbeddings,
  vectorToBuffer,
} from '@/lib/knowledge/embedder';

// memory-v2 语义召回：复用本地 bge-small-zh 嵌入器（离线、无需 provider）。
// 嵌入器不可用时一律返回 null，让上层降级回关键词打分（信号降级，不伪造数据）。

export function memoryEmbedText(title: string, body: string): string {
  return `${title}\n${body}`.replace(/\s+/g, ' ').trim().slice(0, 2000);
}

export async function embedMemoryEntryText(text: string): Promise<Buffer | null> {
  const value = text.trim();
  if (!value) return null;
  try {
    const [vec] = await getEmbeddings([value]);
    return vec ? vectorToBuffer(vec) : null;
  } catch {
    return null;
  }
}

export async function embedMemoryQuery(text: string): Promise<number[] | null> {
  const value = text.trim();
  if (!value) return null;
  try {
    return await embedQuery(value);
  } catch {
    return null;
  }
}

// 记忆↔记忆相似（reconcile 去重用）：与存储向量同口径（doc 式，无"查询:"前缀）。
export async function embedMemoryVector(text: string): Promise<number[] | null> {
  return bufferToVec(await embedMemoryEntryText(text));
}

export function bufferToVec(buf: Buffer | null | undefined): number[] | null {
  if (!buf || buf.length === 0) return null;
  try {
    return bufferToVector(buf);
  } catch {
    return null;
  }
}

// 向量已归一（嵌入器 normalize:true），余弦≈点积；仍按标准式算以防未归一来源。
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
