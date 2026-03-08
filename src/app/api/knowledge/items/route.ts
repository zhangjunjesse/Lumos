import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/knowledge/store';
import { processImport } from '@/lib/knowledge/importer';
import { isPathSafe, isRootPath } from '@/lib/files';
import { buildSourceKey } from '@/lib/knowledge/source-key';
import os from 'os';
import { parseFileForKnowledge, buildReferenceContent } from '@/lib/knowledge/parsers';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  const collectionId = req.nextUrl.searchParams.get('collection_id');
  if (!collectionId) return NextResponse.json({ error: 'collection_id required' }, { status: 400 });
  return NextResponse.json(store.listItems(collectionId));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { collection_id, title, source_type, content, source_path, tags, source_key, source_id } = body;

  if (!collection_id || !title) {
    return NextResponse.json({ error: 'collection_id and title required' }, { status: 400 });
  }

  let text = content || '';
  let resolvedSourcePath = source_path ? path.resolve(source_path) : '';
  let computedSourceKey = source_key || '';
  let importMode: 'full' | 'reference' = 'full';
  let parseError = '';

  if (source_type === 'local_dir') {
    if (!source_path) {
      return NextResponse.json({ error: 'source_path required' }, { status: 400 });
    }
    const resolved = path.resolve(source_path);
    resolvedSourcePath = resolved;
    if (isRootPath(resolved)) {
      return NextResponse.json({ error: 'Cannot use filesystem root' }, { status: 403 });
    }
    const homeDir = os.homedir();
    if (!isPathSafe(homeDir, resolved)) {
      return NextResponse.json({ error: 'Directory is outside the allowed scope' }, { status: 403 });
    }
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
    }
    if (!computedSourceKey) {
      computedSourceKey = buildSourceKey({ sourceType: 'local_dir', sourcePath: resolved });
    }
    let existing = computedSourceKey ? store.findItemBySourceKey(collection_id, computedSourceKey) : undefined;
    if (!existing) {
      existing = store.findItemBySource(collection_id, 'local_dir', resolved);
    }
    if (existing) {
      return NextResponse.json({ duplicate: true, item: existing, message: '目录已存在，已跳过添加' });
    }
    const referenceText = buildReferenceContent(resolved, 'directory_reference');
    const result = await processImport(collection_id, {
      title,
      source_type,
      source_path: resolved,
      source_key: computedSourceKey,
      tags,
    }, referenceText, {
      mode: 'reference',
      parseError: 'directory_reference',
    });
    return NextResponse.json({ ...result, mode: 'reference' });
  }

  // If local/feishu file, validate path and parse it
  if ((source_type === 'local_file' || source_type === 'feishu') && source_path) {
    const resolved = path.resolve(source_path);
    resolvedSourcePath = resolved;
    if (resolved !== source_path && resolved !== path.normalize(source_path)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Path is not a file' }, { status: 400 });
    }
    if (!computedSourceKey) {
      computedSourceKey = buildSourceKey({
        sourceType: source_type,
        sourcePath: resolved,
        extraId: typeof source_id === 'string' ? source_id : undefined,
      });
    }
    let existing = computedSourceKey ? store.findItemBySourceKey(collection_id, computedSourceKey) : undefined;
    if (!existing) {
      existing = store.findItemBySource(collection_id, source_type, resolved);
    }
    if (existing) {
      return NextResponse.json({ duplicate: true, item: existing, message: '资料已存在，已跳过添加' });
    }
    const parsed = await parseFileForKnowledge(resolved);
    text = parsed.content;
    importMode = parsed.mode;
    parseError = parsed.parseError;
  }

  if (source_type === 'manual' && !computedSourceKey) {
    computedSourceKey = buildSourceKey({ sourceType: 'manual', content: text });
  }

  if (source_type === 'webpage' && !computedSourceKey && source_path) {
    computedSourceKey = buildSourceKey({ sourceType: 'webpage', sourcePath: source_path });
  }

  if (computedSourceKey) {
    let existing = store.findItemBySourceKey(collection_id, computedSourceKey);
    if (!existing && source_path) {
      existing = store.findItemBySource(collection_id, source_type, source_path);
    }
    if (existing) {
      return NextResponse.json({ duplicate: true, item: existing, message: '资料已存在，已跳过添加' });
    }
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'Empty content' }, { status: 400 });
  }

  try {
    const result = await processImport(collection_id, {
      title,
      source_type: source_type || 'manual',
      source_path: source_path || resolvedSourcePath,
      source_key: computedSourceKey,
      tags,
    }, text, {
      mode: importMode,
      parseError,
    });

    return NextResponse.json({ ...result, mode: importMode, parse_error: parseError || '' });
  } catch (err) {
    console.error('[api/knowledge/items] Import failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  return NextResponse.json({ deleted: store.deleteItem(id) });
}
