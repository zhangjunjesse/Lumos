/**
 * 从 DebugStepOutput.output 里抽取结构化信息给 UI 分块展示。
 *
 * output 是 stage-worker 产出的标准 shape:
 *   { summary, outcome, role, roleName, artifacts, diagnostics, memoryAppend, metrics, ...业务字段 }
 *
 * 业务字段会混在顶层,我们把保留字段过滤出来,剩下的就是这个节点真实的产出数据。
 */

export interface ArtifactItem {
  path: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface DiagnosticsInfo {
  errorName?: string;
  sanitizedMessage?: string;
  rawMessage?: string;
  executionCwd?: string;
  allowedRuntimeTools?: string[];
  allowedClaudeTools?: string[];
}

export interface MemoryItem {
  scope: string;
  content: string;
}

export interface ExtractedOutput {
  summary: string | null;
  role: string | null;
  roleName: string | null;
  outcome: string | null;
  agentType: string | null;
  artifacts: ArtifactItem[];
  businessFields: Array<[string, unknown]>;
  diagnostics: DiagnosticsInfo | null;
  memoryAppend: MemoryItem[];
  metrics: Record<string, unknown> | null;
}

const RESERVED_KEYS = new Set([
  'summary', 'outcome', 'role', 'roleName', 'agentType',
  'detailArtifactPath', 'artifacts', 'diagnostics',
  'memoryAppend', 'metrics',
]);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asArtifacts(v: unknown): ArtifactItem[] {
  if (!Array.isArray(v)) return [];
  const items: ArtifactItem[] = [];
  for (const entry of v) {
    if (typeof entry === 'string') {
      items.push({ path: entry, name: basename(entry) });
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const path = str(obj['path']) ?? str(obj['filePath']) ?? str(obj['uri']);
      if (path) {
        items.push({
          path,
          name: str(obj['name']) ?? basename(path),
          mimeType: str(obj['mimeType']) ?? undefined,
          sizeBytes: typeof obj['sizeBytes'] === 'number' ? obj['sizeBytes'] : undefined,
        });
      }
    }
  }
  return items;
}

function basename(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return slash >= 0 ? p.slice(slash + 1) : p;
}

function asDiagnostics(v: unknown): DiagnosticsInfo | null {
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  return {
    errorName: str(obj['errorName']) ?? undefined,
    sanitizedMessage: str(obj['sanitizedMessage']) ?? undefined,
    rawMessage: str(obj['rawMessage']) ?? undefined,
    executionCwd: str(obj['executionCwd']) ?? undefined,
    allowedRuntimeTools: Array.isArray(obj['allowedRuntimeTools'])
      ? (obj['allowedRuntimeTools'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
    allowedClaudeTools: Array.isArray(obj['allowedClaudeTools'])
      ? (obj['allowedClaudeTools'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
  };
}

function asMemory(v: unknown): MemoryItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map(e => ({
      scope: str(e['scope']) ?? 'unknown',
      content: str(e['content']) ?? '',
    }))
    .filter(m => m.content.length > 0);
}

export function extractOutput(raw: unknown): ExtractedOutput {
  if (!raw || typeof raw !== 'object') {
    return {
      summary: null, role: null, roleName: null, outcome: null, agentType: null,
      artifacts: [], businessFields: [], diagnostics: null, memoryAppend: [], metrics: null,
    };
  }
  const obj = raw as Record<string, unknown>;

  const businessFields: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (RESERVED_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    businessFields.push([k, v]);
  }

  return {
    summary: str(obj['summary']),
    role: str(obj['role']),
    roleName: str(obj['roleName']),
    outcome: str(obj['outcome']),
    agentType: str(obj['agentType']),
    artifacts: asArtifacts(obj['artifacts']),
    businessFields,
    diagnostics: asDiagnostics(obj['diagnostics']),
    memoryAppend: asMemory(obj['memoryAppend']),
    metrics: (obj['metrics'] && typeof obj['metrics'] === 'object')
      ? obj['metrics'] as Record<string, unknown>
      : null,
  };
}
