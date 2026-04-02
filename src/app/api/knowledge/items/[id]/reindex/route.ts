import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import * as store from '@/lib/knowledge/store';
import { splitText } from '@/lib/knowledge/chunker';
import { indexItem } from '@/lib/knowledge/embedder';
import { indexItemChunks, removeItemFromIndex } from '@/lib/knowledge/bm25';
import { parseFileForKnowledge, buildReferenceContent } from '@/lib/knowledge/parsers';
import { clearSummaryArtifacts, summarizeAndEmbedStrict } from '@/lib/knowledge/summarizer';
import { autoTagCategorizedStrict } from '@/lib/knowledge/tagger';
import { buildTagCandidates, syncItemTagSystem } from '@/lib/knowledge/tag-system';
import { isKnowledgeEnhancementUnavailableError } from '@/lib/knowledge/llm';
import type { KbItem, KbProcessingStatus, CategorizedTag } from '@/lib/knowledge/types';
import {
  detailToJson,
  resolveStatus,
  stageFailed,
  type ProcessingDetail,
} from '@/lib/knowledge/processing-status';
import {
  appendProcessingError,
  appendProcessingMessage,
  buildStoredPreviewContent,
  loadFullItemContent,
} from '@/lib/knowledge/pipeline-support';

function buildMissingSourceReference(sourcePath: string, reason: string): string {
  return [
    '[Reference Only]',
    `Path: ${sourcePath || '-'}`,
    `Reason: ${reason}`,
    'Original source is unavailable. Keep this entry as reference only.',
  ].join('\n');
}

function parseTagList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveReindexSource(item: KbItem, reparse: boolean): Promise<{
  title: string;
  content: string;
  mode: 'full' | 'reference';
  parseError: string;
}> {
  const sourcePath = item.source_path || '';
  const fallbackContent = loadFullItemContent(item.id, item.content || '');
  const base = {
    title: item.title || 'Untitled',
    content: fallbackContent,
    mode: 'full' as const,
    parseError: '',
  };

  if (item.source_type === 'local_dir') {
    if (sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
      return {
        title: base.title,
        content: buildReferenceContent(sourcePath, 'directory_reference'),
        mode: 'reference',
        parseError: 'directory_reference',
      };
    }
    return {
      title: base.title,
      content: buildMissingSourceReference(sourcePath, 'directory_missing'),
      mode: 'reference',
      parseError: 'directory_missing',
    };
  }

  if ((item.source_type === 'local_file' || item.source_type === 'feishu') && reparse) {
    if (sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
      const parsed = await parseFileForKnowledge(sourcePath);
      return {
        title: parsed.title || base.title,
        content: parsed.content,
        mode: parsed.mode,
        parseError: parsed.parseError || '',
      };
    }
    return {
      title: base.title,
      content: buildMissingSourceReference(sourcePath, 'source_missing'),
      mode: 'reference',
      parseError: 'source_missing',
    };
  }

  if (item.source_type === 'webpage') {
    if (base.content.trim()) return base;
    return {
      title: base.title,
      content: [
        '[Reference Only]',
        `URL: ${sourcePath || '-'}`,
        'Reason: empty_web_content',
        'Original clipped text is empty. Keep URL as reference.',
      ].join('\n'),
      mode: 'reference',
      parseError: 'empty_web_content',
    };
  }

  if (item.source_type === 'manual' && !base.content.trim()) {
    return {
      title: base.title,
      content: [
        '[Reference Only]',
        `Title: ${base.title}`,
        'Reason: empty_manual_content',
      ].join('\n'),
      mode: 'reference',
      parseError: 'empty_manual_content',
    };
  }

  return base;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const item = store.getItem(id);
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const originalTags = parseTagList(item.tags || '[]');

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // keep empty body
  }
  const reparse = body.reparse !== false;

  const resolved = await resolveReindexSource(item, reparse);
  const detail: ProcessingDetail = {
    mode: resolved.mode,
    parse: resolved.parseError ? 'failed' : 'done',
    chunk: 'pending',
    bm25: 'pending',
    embedding: resolved.mode === 'reference' ? 'skipped' : 'pending',
    summary: resolved.mode === 'reference' ? 'skipped' : 'pending',
  };
  let processingError = appendProcessingMessage('', '解析', resolved.parseError);

  const persist = (patch?: { status?: KbProcessingStatus; error?: string; chunkCount?: number }) => {
    const status = patch?.status || resolveStatus(detail, stageFailed(detail));
    store.patchItem(id, {
      title: resolved.title,
      content: buildStoredPreviewContent(resolved.content),
      processing_status: status,
      processing_detail: detailToJson(detail),
      processing_error: patch?.error ?? processingError,
      processing_updated_at: new Date().toISOString(),
      ...(typeof patch?.chunkCount === 'number' ? { chunk_count: patch.chunkCount } : {}),
    });
  };

  try {
    clearSummaryArtifacts(id);

    if (resolved.mode === 'reference') {
      const referenceText = resolved.content.trim() || buildMissingSourceReference(item.source_path || '', 'reference_empty');
      detail.chunk = 'running';
      persist();

      removeItemFromIndex(id);
      store.saveChunks(id, [referenceText]);
      detail.chunk = 'done';

      detail.bm25 = 'running';
      persist({ chunkCount: 1 });
      try {
        indexItemChunks(id, [referenceText], resolved.title);
        detail.bm25 = 'done';
      } catch (error) {
        detail.bm25 = 'failed';
        processingError = appendProcessingError(
          processingError,
          '检索索引',
          error,
          'bm25_index_failed',
        );
      }

      persist({
        status: resolveStatus(detail, stageFailed(detail)),
        chunkCount: 1,
      });

      try {
        syncItemTagSystem(id, buildTagCandidates(originalTags, []));
      } catch (error) {
        console.error('[api/knowledge/items/:id/reindex] tag sync failed:', error);
      }

      return NextResponse.json({ item: store.getItem(id), mode: 'reference', chunkCount: 1 });
    }

    detail.chunk = 'running';
    persist();
    const chunks = splitText(resolved.content).filter((chunk) => chunk.trim().length > 0);
    if (!chunks.length) {
      detail.chunk = 'failed';
      persist({ status: 'failed', error: resolved.parseError || 'empty_chunks' });
      return NextResponse.json({ error: 'no valid chunks generated' }, { status: 400 });
    }
    detail.chunk = 'done';

    removeItemFromIndex(id);
    store.saveChunks(id, chunks);
    persist({ chunkCount: chunks.length });

    detail.bm25 = 'running';
    persist();
    try {
      indexItemChunks(id, chunks, resolved.title);
      detail.bm25 = 'done';
    } catch (error) {
      detail.bm25 = 'failed';
      processingError = appendProcessingError(
        processingError,
        '检索索引',
        error,
        'bm25_index_failed',
      );
    }
    persist();

    detail.embedding = 'running';
    persist();
    try {
      await indexItem(id, chunks);
      detail.embedding = 'done';
    } catch (error) {
      detail.embedding = 'failed';
      processingError = appendProcessingError(
        processingError,
        '向量化',
        error,
        'embedding_failed',
      );
    }
    persist();

    detail.summary = 'running';
    persist();
    try {
      const summary = await summarizeAndEmbedStrict(id);
      if (summary) {
        detail.summary = 'done';
      } else {
        detail.summary = 'failed';
        processingError = appendProcessingMessage(
          processingError,
          '摘要',
          '模型返回空内容，请检查服务商配置和模型是否可用',
        );
      }
    } catch (error) {
      if (isKnowledgeEnhancementUnavailableError(error)) {
        detail.summary = 'skipped';
      } else {
        detail.summary = 'failed';
        processingError = appendProcessingError(
          processingError,
          '摘要',
          error,
          'summary_failed',
        );
      }
    }

    // Refresh auto tags after reindex and sync to tag taxonomy.
    let nextTags = originalTags;
    try {
      const categorized = await autoTagCategorizedStrict(resolved.content, originalTags);
      const aiTags: CategorizedTag[] = [...categorized.matched, ...categorized.suggested];
      if (aiTags.length > 0) {
        nextTags = Array.from(new Set([...originalTags, ...aiTags.map((tag) => tag.name)]));
        store.patchItem(id, { tags: JSON.stringify(nextTags) });
      }
      syncItemTagSystem(id, buildTagCandidates(nextTags, aiTags));
    } catch (error) {
      if (!isKnowledgeEnhancementUnavailableError(error)) {
        console.error('[api/knowledge/items/:id/reindex] auto-tag failed:', error);
        processingError = appendProcessingError(
          processingError,
          '标签',
          error,
          'tag_generation_failed',
        );
      }
    }

    persist({
      status: resolveStatus(detail, stageFailed(detail)),
      chunkCount: chunks.length,
    });

    return NextResponse.json({
      item: store.getItem(id),
      mode: resolved.mode,
      chunkCount: chunks.length,
    });
  } catch (error) {
    console.error('[api/knowledge/items/:id/reindex] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'reindex failed' },
      { status: 500 },
    );
  }
}
