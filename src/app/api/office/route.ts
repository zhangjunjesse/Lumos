import { NextRequest, NextResponse } from 'next/server';
import {
  readExcel, writeExcel,
  evalFormulas, getSupportedFunctions,
  readWord, writeWord,
  readPdfInfo, createPdf, mergePdfs, splitPdf,
  createPpt,
} from '@/lib/office';
import { assertSafePath } from '@/lib/office/path-guard';

type ActionHandler = (body: Record<string, unknown>) => Promise<unknown>;

function safePath(body: Record<string, unknown>, key: string): string {
  return assertSafePath(body[key] as string);
}

function safePaths(body: Record<string, unknown>, key: string): string[] {
  const arr = body[key] as string[];
  return arr.map((p) => assertSafePath(p));
}

const ACTIONS: Record<string, ActionHandler> = {
  read_spreadsheet: async (body) => {
    return readExcel(safePath(body, 'filePath'), {
      sheetName: body.sheetName as string | undefined,
      maxRows: body.maxRows as number | undefined,
    });
  },

  write_spreadsheet: async (body) => {
    const fp = await writeExcel({
      filePath: safePath(body, 'filePath'),
      sheets: body.sheets as Parameters<typeof writeExcel>[0]['sheets'],
    });
    return { filePath: fp, success: true };
  },

  eval_formulas: async (body) => {
    return evalFormulas(
      body.sheet as Parameters<typeof evalFormulas>[0],
      body.formulas as Parameters<typeof evalFormulas>[1],
    );
  },

  list_functions: async () => {
    return { functions: getSupportedFunctions() };
  },

  read_document: async (body) => {
    return readWord(safePath(body, 'filePath'));
  },

  create_document: async (body) => {
    const fp = await writeWord({
      filePath: safePath(body, 'filePath'),
      title: body.title as string | undefined,
      sections: body.sections as Parameters<typeof writeWord>[0]['sections'],
    });
    return { filePath: fp, success: true };
  },

  read_pdf: async (body) => {
    return readPdfInfo(safePath(body, 'filePath'));
  },

  create_pdf: async (body) => {
    const fp = await createPdf({
      filePath: safePath(body, 'filePath'),
      title: body.title as string | undefined,
      pages: body.pages as Parameters<typeof createPdf>[0]['pages'],
      pageSize: body.pageSize as Parameters<typeof createPdf>[0]['pageSize'],
    });
    return { filePath: fp, success: true };
  },

  merge_pdfs: async (body) => {
    const validated = safePaths(body, 'filePaths');
    const fp = await mergePdfs(validated, safePath(body, 'outputPath'));
    return { filePath: fp, success: true };
  },

  split_pdf: async (body) => {
    const fps = await splitPdf(
      safePath(body, 'filePath'),
      safePath(body, 'outputDir'),
      body.pageRanges as { start: number; end: number }[],
    );
    return { filePaths: fps, success: true };
  },

  create_presentation: async (body) => {
    const fp = await createPpt({
      filePath: safePath(body, 'filePath'),
      title: body.title as string | undefined,
      author: body.author as string | undefined,
      slides: body.slides as Parameters<typeof createPpt>[0]['slides'],
      layout: body.layout as '16x9' | '4x3' | undefined,
    });
    return { filePath: fp, success: true };
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (!action || !ACTIONS[action]) {
      return NextResponse.json(
        { error: `Unknown action: ${action}. Available: ${Object.keys(ACTIONS).join(', ')}` },
        { status: 400 },
      );
    }

    const result = await ACTIONS[action](body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[office-api]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
