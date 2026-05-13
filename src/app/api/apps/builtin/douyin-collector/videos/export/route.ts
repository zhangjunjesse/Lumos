import { NextRequest, NextResponse } from 'next/server';

import {
  exportLibraryAsAnki,
  exportLibraryAsCsv,
  exportLibraryAsJson,
  exportLibraryAsMarkdown,
} from '@/lib/douyin-collector/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const scopeRaw = url.searchParams.get('scope') ?? 'published';
    const scope: 'all' | 'published' | 'draft' =
      scopeRaw === 'all' || scopeRaw === 'draft' ? scopeRaw : 'published';
    const includeTranscript = url.searchParams.get('transcript') !== '0';
    const formatRaw = url.searchParams.get('format');
    const format: 'markdown' | 'json' | 'anki' | 'csv' =
      formatRaw === 'json'
        ? 'json'
        : formatRaw === 'anki'
          ? 'anki'
          : formatRaw === 'csv'
            ? 'csv'
            : 'markdown';

    // Round 178: when caller passes explicit ids (filter-aware export
    // from LibraryTab), restrict the export to those rows. Each export
    // function applies its own scope filter on top — so even with ids
    // we honor "published" / "draft" semantics, just within the subset.
    const idsParam = url.searchParams.get('ids') ?? '';
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const opts = {
      scope,
      includeTranscript,
      ...(ids.length > 0 ? { ids } : {}),
    };
    const today = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csv = exportLibraryAsCsv(opts);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          // BOM-less utf-8: most modern tools (Numbers, recent Excel,
          // Sheets) handle it. Add `﻿` prefix to the body if
          // legacy Excel users complain.
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="douyin-collector-${scope}-${today}.csv"`,
        },
      });
    }

    if (format === 'anki') {
      const tsv = exportLibraryAsAnki(opts);
      return new NextResponse(tsv, {
        status: 200,
        headers: {
          // Anki documents using `text/plain` for TSV imports; `.txt`
          // extension matches what Anki's import dialog suggests.
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename="douyin-collector-${scope}-${today}.anki.txt"`,
        },
      });
    }

    if (format === 'json') {
      const items = exportLibraryAsJson(opts);
      const body = JSON.stringify(
        { generatedAt: new Date().toISOString(), scope, items },
        null,
        2,
      );
      return new NextResponse(body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="douyin-collector-${scope}-${today}.json"`,
        },
      });
    }

    const md = exportLibraryAsMarkdown(opts);
    return new NextResponse(md, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="douyin-collector-${scope}-${today}.md"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
