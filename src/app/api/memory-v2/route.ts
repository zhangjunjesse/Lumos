import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createMemoryV2Entry,
  listMemoryV2Entries,
  parseMemoryV2Tags,
} from '@/lib/memory-v2/store';
import { processMemoryV2ResourceSecrets } from '@/lib/memory-v2/resource-secrets';
import type { MemoryV2Entry } from '@/lib/memory-v2/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const kindSchema = z.enum(['task', 'people', 'resource', 'capability', 'reflection']);
const scopeTypeSchema = z.enum(['user', 'main_agent', 'project', 'session', 'module', 'entity']);
const statusSchema = z.enum(['candidate', 'active', 'archived', 'rejected']);
const sensitivitySchema = z.enum(['normal', 'sensitive_ref', 'secret_ref_required']);

const createSchema = z.object({
  kind: kindSchema,
  scopeType: scopeTypeSchema,
  scopeKey: z.string().trim().optional(),
  ownerModule: z.string().trim().optional(),
  status: statusSchema.optional(),
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(8000),
  summary: z.string().trim().max(1200).optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  sourceType: z.string().trim().max(80).optional(),
  sourceId: z.string().trim().max(240).optional(),
  sessionId: z.string().trim().max(80).optional(),
  messageId: z.string().trim().max(80).optional(),
  projectPath: z.string().trim().max(1024).optional(),
  relatedEntityType: z.string().trim().max(80).optional(),
  relatedEntityId: z.string().trim().max(160).optional(),
  sensitivity: sensitivitySchema.optional(),
  secretRef: z.string().trim().max(240).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  evidence: z.string().trim().max(2400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function serialize(entry: MemoryV2Entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    scopeType: entry.scope_type,
    scopeKey: entry.scope_key,
    ownerModule: entry.owner_module,
    status: entry.status,
    title: entry.title,
    body: entry.body,
    summary: entry.summary,
    tags: parseMemoryV2Tags(entry.tags),
    sourceType: entry.source_type,
    sourceId: entry.source_id,
    sessionId: entry.session_id,
    messageId: entry.message_id,
    projectPath: entry.project_path,
    relatedEntityType: entry.related_entity_type,
    relatedEntityId: entry.related_entity_id,
    sensitivity: entry.sensitivity,
    secretRef: entry.secret_ref,
    confidence: entry.confidence,
    importance: entry.importance,
    evidence: entry.evidence,
    metadata: safeParse(entry.metadata),
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    lastUsedAt: entry.last_used_at,
    hitCount: entry.hit_count,
  };
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const status = url.searchParams.get('status') || undefined;
    const kind = url.searchParams.get('kind') || undefined;
    const scopeType = url.searchParams.get('scopeType') || undefined;
    const limitRaw = Number(url.searchParams.get('limit') || '');
    const memories = listMemoryV2Entries({
      status: status === 'all' || statusSchema.safeParse(status).success ? status as never : undefined,
      kind: kind === 'all' || kindSchema.safeParse(kind).success ? kind as never : undefined,
      scopeType: scopeType === 'all' || scopeTypeSchema.safeParse(scopeType).success ? scopeType as never : undefined,
      scopeKey: url.searchParams.get('scopeKey') || undefined,
      ownerModule: url.searchParams.get('ownerModule') || undefined,
      query: url.searchParams.get('q') || undefined,
      includeArchived: url.searchParams.get('includeArchived') === 'true' || status === 'all',
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 300,
    });
    return NextResponse.json({
      memories: memories.map(serialize),
      total: memories.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list Memory v2 entries';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = createSchema.parse(body);
    let memoryInput = input;
    if (input.kind === 'resource') {
      const scopeKey = input.scopeType === 'user'
        ? 'default'
        : input.scopeType === 'main_agent'
          ? 'main'
          : input.scopeKey || input.projectPath || input.sessionId || input.relatedEntityId || '';
      const secretParams = {
        scopeType: input.scopeType,
        scopeKey,
        ownerModule: input.ownerModule || 'memory-v2-ui',
        sessionId: input.sessionId,
        messageId: input.messageId,
        projectPath: input.projectPath,
        sourceType: input.sourceType || 'memory_v2_ui',
        sourceId: input.sourceId || input.messageId,
      };
      const bodyResult = processMemoryV2ResourceSecrets(input.body, secretParams);
      const titleResult = processMemoryV2ResourceSecrets(input.title, secretParams);
      const secretRefs = Array.from(new Set([...bodyResult.secretRefs, ...titleResult.secretRefs]));
      memoryInput = {
        ...input,
        title: titleResult.text,
        body: bodyResult.text,
        sensitivity: secretRefs.length > 0 ? 'sensitive_ref' : bodyResult.sensitivity,
        secretRef: secretRefs[0] || input.secretRef,
        evidence: secretRefs.length > 0
          ? `用户提供了敏感值，已自动加密保存到 Vault：${secretRefs.join(', ')}`
          : input.evidence,
        metadata: {
          ...(input.metadata || {}),
          ...(secretRefs.length > 0 ? { secretRefs } : {}),
        },
      };
    }
    const memory = createMemoryV2Entry(memoryInput);
    return NextResponse.json({ memory: serialize(memory) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Memory v2 entry';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
