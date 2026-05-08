import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteMemoryV2Entry,
  getMemoryV2Entry,
  parseMemoryV2Tags,
  setMemoryV2Status,
  updateMemoryV2Entry,
} from '@/lib/memory-v2/store';
import { processMemoryV2ResourceSecrets } from '@/lib/memory-v2/resource-secrets';
import type { MemoryV2Entry } from '@/lib/memory-v2/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  kind: z.enum(['task', 'people', 'resource', 'capability', 'reflection']).optional(),
  scopeType: z.enum(['user', 'main_agent', 'project', 'session', 'module', 'entity']).optional(),
  scopeKey: z.string().trim().optional(),
  ownerModule: z.string().trim().optional(),
  status: z.enum(['candidate', 'active', 'archived', 'rejected']).optional(),
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().min(1).max(8000).optional(),
  summary: z.string().trim().max(1200).optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  sourceType: z.string().trim().max(80).optional(),
  sourceId: z.string().trim().max(240).optional(),
  sessionId: z.string().trim().max(80).optional(),
  messageId: z.string().trim().max(80).optional(),
  projectPath: z.string().trim().max(1024).optional(),
  relatedEntityType: z.string().trim().max(80).optional(),
  relatedEntityId: z.string().trim().max(160).optional(),
  sensitivity: z.enum(['normal', 'sensitive_ref', 'secret_ref_required']).optional(),
  secretRef: z.string().trim().max(240).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  evidence: z.string().trim().max(2400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

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

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const memory = getMemoryV2Entry(id);
  if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ memory: serialize(memory) });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = updateSchema.parse(body);
    const existing = getMemoryV2Entry(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    let updateInput = input;
    const nextKind = input.kind || existing.kind;
    if (nextKind === 'resource' && (input.title !== undefined || input.body !== undefined)) {
      const scopeType = input.scopeType || existing.scope_type;
      const scopeKey = input.scopeKey || existing.scope_key;
      const secretParams = {
        scopeType,
        scopeKey,
        ownerModule: input.ownerModule || existing.owner_module || 'memory-v2-ui',
        sessionId: input.sessionId || existing.session_id,
        messageId: input.messageId || existing.message_id,
        projectPath: input.projectPath || existing.project_path,
        sourceType: input.sourceType || existing.source_type || 'memory_v2_ui',
        sourceId: input.sourceId || existing.source_id || existing.message_id,
      };
      const bodyResult = input.body !== undefined
        ? processMemoryV2ResourceSecrets(input.body, secretParams)
        : null;
      const titleResult = input.title !== undefined
        ? processMemoryV2ResourceSecrets(input.title, secretParams)
        : null;
      const secretRefs = Array.from(new Set([
        ...(bodyResult?.secretRefs || []),
        ...(titleResult?.secretRefs || []),
      ]));
      updateInput = {
        ...input,
        ...(titleResult ? { title: titleResult.text } : {}),
        ...(bodyResult ? { body: bodyResult.text } : {}),
        ...(secretRefs.length > 0 ? {
          sensitivity: 'sensitive_ref',
          secretRef: secretRefs[0],
          evidence: `用户提供了敏感值，已自动加密保存到 Vault：${secretRefs.join(', ')}`,
          metadata: {
            ...(input.metadata || safeParse(existing.metadata)),
            secretRefs,
          },
        } : {}),
      };
    }
    const memory = updateMemoryV2Entry(id, updateInput);
    if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ memory: serialize(memory) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update memory';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const hard = request.nextUrl.searchParams.get('hard') === 'true';
  const ok = hard ? deleteMemoryV2Entry(id) : setMemoryV2Status(id, 'archived');
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: hard });
}
