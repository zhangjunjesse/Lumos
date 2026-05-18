import crypto from 'crypto';
import { listMemoryV2Entries } from './store';
import type { MemoryV2Entry, MemoryV2Kind, MemoryV2ScopeType } from './types';

export interface MemoryV2SamenessInput {
  kind: MemoryV2Kind;
  scopeType: MemoryV2ScopeType;
  scopeKey: string;
  title: string;
  body: string;
}

// 同一条事实即便措辞/时间戳不同也要判为重复：先抹掉易变的时间戳，
// 再做大小写 + 标点归一。库里"睡眠体检单"长期去不掉重复，根因就是
// 旧逻辑把 body 里的 ISO 时间戳算进了 key。
const VOLATILE_TIMESTAMP = /\d{4}-\d{2}-\d{2}[t \d:.\-z]*/gi;

export function normalizeForSignature(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(VOLATILE_TIMESTAMP, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeScopeKey(scopeType: MemoryV2ScopeType, scopeKey: string): string {
  if (scopeType === 'user') return 'default';
  if (scopeType === 'main_agent') return 'main';
  return (scopeKey || '').trim();
}

export function memorySignature(input: MemoryV2SamenessInput): string {
  const scopeKey = normalizeScopeKey(input.scopeType, input.scopeKey);
  const content = normalizeForSignature(`${input.title} ${input.body}`).slice(0, 600);
  return crypto
    .createHash('sha1')
    .update(`${input.kind}|${input.scopeType}|${scopeKey}|${content}`)
    .digest('hex')
    .slice(0, 24);
}

export function tokenSet(value: string): Set<string> {
  const norm = normalizeForSignature(value);
  const tokens = new Set<string>();
  for (const word of norm.split(' ')) {
    if (word.length >= 2) tokens.add(word);
  }
  // 中文按字符 bigram 切，避免"一整段无空格 CJK"塌成单个 token。
  for (const run of norm.match(/[一-鿿]{2,}/g) || []) {
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return tokens;
}

// 用 Jaccard（shared / union）而不是 shared / min：后者是"包含式"，
// 当一条记忆正当地把另一条原文嵌进证据时会被误判成重复。
export function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

export function isNearDuplicate(
  a: MemoryV2SamenessInput,
  b: MemoryV2SamenessInput,
  threshold = 0.8,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.scopeType !== b.scopeType) return false;
  if (normalizeScopeKey(a.scopeType, a.scopeKey) !== normalizeScopeKey(b.scopeType, b.scopeKey)) return false;
  if (memorySignature(a) === memorySignature(b)) return true;
  return overlapRatio(
    tokenSet(`${a.title} ${a.body}`),
    tokenSet(`${b.title} ${b.body}`),
  ) >= threshold;
}

function toSameness(entry: MemoryV2Entry): MemoryV2SamenessInput {
  return {
    kind: entry.kind,
    scopeType: entry.scope_type,
    scopeKey: entry.scope_key,
    title: entry.title,
    body: entry.body,
  };
}

export function findActiveDuplicate(input: MemoryV2SamenessInput): MemoryV2Entry | null {
  const peers = listMemoryV2Entries({
    status: 'active',
    kind: input.kind,
    scopeType: input.scopeType,
    scopeKey: normalizeScopeKey(input.scopeType, input.scopeKey),
    limit: 200,
  });
  for (const entry of peers) {
    if (isNearDuplicate(input, toSameness(entry))) return entry;
  }
  return null;
}

export { toSameness as memorySamenessOf };
