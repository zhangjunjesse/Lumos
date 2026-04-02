import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/knowledge/store';
import { splitText } from '@/lib/knowledge/chunker';
import { indexItem } from '@/lib/knowledge/embedder';
import { indexItemChunks, removeItemFromIndex } from '@/lib/knowledge/bm25';
import { buildTagCandidates, syncItemTagSystem } from '@/lib/knowledge/tag-system';
import {
  appendProcessingError,
  appendProcessingMessage,
  buildStoredPreviewContent,
  loadFullItemContent,
} from '@/lib/knowledge/pipeline-support';
import { clearSummaryArtifacts, summarizeAndEmbedStrict } from '@/lib/knowledge/summarizer';
import { isKnowledgeEnhancementUnavailableError } from '@/lib/knowledge/llm';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const item = store.getItem(id);
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    ...item,
    full_content: loadFullItemContent(id, item.content),
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const current = store.getItem(id);
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  let normalizedTags: string[] | null = null;

  const title = typeof body.title === 'string' ? body.title.trim() : undefined;
  if (title !== undefined) {
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    patch.title = title;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
    }
    const tags = Array.from(
      new Set(
        body.tags
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    normalizedTags = tags;
    patch.tags = JSON.stringify(tags);
  }

  let nextContent: string | null = null;
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be string' }, { status: 400 });
    }
    nextContent = body.content.trim();
    if (!nextContent) {
      return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 });
    }
    patch.content = buildStoredPreviewContent(nextContent);
  }

  if (nextContent !== null) {
    const chunks = splitText(nextContent).filter((chunk) => chunk.trim().length > 0);
    if (!chunks.length) {
      return NextResponse.json({ error: 'no valid chunks generated' }, { status: 400 });
    }

    const nextTitle = (patch.title as string | undefined) || current.title;
    try {
      clearSummaryArtifacts(id);
      removeItemFromIndex(id);
      store.saveChunks(id, chunks);
      indexItemChunks(id, chunks, nextTitle);
    } catch (err) {
      console.error('[api/knowledge/items/:id] Re-index failed:', err);
      return NextResponse.json({ error: 'failed to rebuild index' }, { status: 500 });
    }

    let processingError = '';
    let embeddingOk = true;
    try {
      await indexItem(id, chunks);
    } catch (err) {
      embeddingOk = false;
      console.error('[api/knowledge/items/:id] Embedding update failed:', err);
      processingError = appendProcessingError(
        processingError,
        '向量化',
        err,
        'embedding_update_failed',
      );
    }

    let summaryOk = true;
    let summaryStage: 'done' | 'failed' | 'skipped' = 'done';
    try {
      const summary = await summarizeAndEmbedStrict(id);
      if (!summary) {
        summaryOk = false;
        summaryStage = 'failed';
        processingError = appendProcessingMessage(processingError, '摘要', '模型返回空内容，请检查服务商配置和模型是否可用');
      }
    } catch (err) {
      if (isKnowledgeEnhancementUnavailableError(err)) {
        summaryOk = true;
        summaryStage = 'skipped';
      } else {
        summaryOk = false;
        summaryStage = 'failed';
        console.error('[api/knowledge/items/:id] Summary update failed:', err);
        processingError = appendProcessingError(
          processingError,
          '摘要',
          err,
          'summary_update_failed',
        );
      }
    }

    patch.chunk_count = chunks.length;
    patch.processing_status = embeddingOk && summaryOk ? 'ready' : 'partial';
    patch.processing_error = processingError;
    patch.processing_updated_at = new Date().toISOString();
    patch.processing_detail = JSON.stringify({
      mode: 'full',
      parse: 'done',
      chunk: 'done',
      bm25: 'done',
      embedding: embeddingOk ? 'done' : 'failed',
      summary: summaryStage,
    });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no updates provided' }, { status: 400 });
  }

  const item = store.patchItem(id, patch);

  if (normalizedTags) {
    try {
      syncItemTagSystem(id, buildTagCandidates(normalizedTags, []));
    } catch (error) {
      console.error('[api/knowledge/items/:id] tag sync failed:', error);
    }
  }

  return NextResponse.json({ item });
}
