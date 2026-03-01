import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/knowledge/store';
import { processImport } from '@/lib/knowledge/importer';
import { parseFile } from '@/lib/knowledge/parsers';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  const collectionId = req.nextUrl.searchParams.get('collection_id');
  if (!collectionId) return NextResponse.json({ error: 'collection_id required' }, { status: 400 });
  return NextResponse.json(store.listItems(collectionId));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { collection_id, title, source_type, content, source_path, tags } = body;

  if (!collection_id || !title) {
    return NextResponse.json({ error: 'collection_id and title required' }, { status: 400 });
  }

  let text = content || '';

  // If local file, validate path and parse it
  if (source_type === 'local_file' && source_path) {
    const resolved = path.resolve(source_path);
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
    text = await parseFile(resolved);
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'Empty content' }, { status: 400 });
  }

  try {
    const result = await processImport(collection_id, {
      title,
      source_type: source_type || 'manual',
      source_path,
      tags,
    }, text);

    return NextResponse.json(result);
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
