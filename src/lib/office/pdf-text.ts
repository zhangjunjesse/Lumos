import fs from 'fs';
import { execFileSync } from 'child_process';
import { PDFDocument } from 'pdf-lib';

// Single source of truth for "pull the text layer out of a PDF". Two callers
// share it: the office-docs `extract_pdf_text` MCP tool (interactive) and the
// knowledge-base ingestion pipeline (`parsers.ts`). Strategy: prefer the
// `pdftotext` system binary (best layout fidelity) when present, fall back to
// the bundled pure-JS `pdf-parse`. When neither yields text but the document
// has pages, it is almost certainly a scanned / image-only PDF — surface that
// explicitly so the agent OCRs the pages instead of silently getting nothing.

export type PdfTextMethod = 'pdftotext' | 'pdf-parse' | 'none';

export interface ExtractPdfTextResult {
  text: string;
  pageCount: number;
  /** Title from the PDF info dict, when available. */
  title?: string;
  /** Which extractor produced the text; 'none' means no text layer was found. */
  method: PdfTextMethod;
  /** True when the PDF has pages but no extractable text — a scanned/image PDF. */
  isScanned: boolean;
  /** Concrete next step for the agent when there is no text to read. */
  nextAction?: string;
}

const SCANNED_NEXT_ACTION =
  'This PDF has no extractable text layer (scanned or image-only). '
  + 'Render each page to an image (split_pdf is text-only and will not help here — '
  + 'use the built-in Read tool on the .pdf, or `pdftoppm -jpeg <file> <prefix>`), '
  + 'then call the image-reader `read_image` tool on each page image so the vision '
  + 'model can read the content. Do not report the PDF as empty.';

// A real text PDF carries far more than this even on a single page; a scanned
// one yields ~0 (occasionally a few stray glyphs). Strip whitespace and require
// a minimum so a short-but-real PDF is never mislabelled as scanned.
const MIN_MEANINGFUL_CHARS = 16;

function runPdftotext(filePath: string): string {
  try {
    return execFileSync('pdftotext', ['-layout', filePath, '-'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 90_000,
    });
  } catch {
    // Binary missing or failed — fall through to pdf-parse.
    return '';
  }
}

async function runPdfParse(buf: Buffer): Promise<{ text: string; pageCount: number; title?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('pdf-parse' as any);

  // v2 API: `new PDFParse({ data }).getText()`
  const PDFParseCtor = mod?.PDFParse || mod?.default?.PDFParse;
  if (typeof PDFParseCtor === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new PDFParseCtor({ data: new Uint8Array(buf) }) as any;
    try {
      const result = await parser.getText();
      return {
        text: typeof result?.text === 'string' ? result.text : '',
        pageCount: Number(result?.total ?? result?.numpages ?? 0) || 0,
        title: result?.info?.Title || undefined,
      };
    } finally {
      try {
        if (typeof parser?.destroy === 'function') await parser.destroy();
      } catch {
        // ignore parser cleanup errors
      }
    }
  }

  // v1 function API.
  const candidate = mod?.default ?? mod;
  const pdfParse = typeof candidate === 'function' ? candidate : (candidate?.default ?? candidate);
  if (typeof pdfParse === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await pdfParse(buf) as any;
    return {
      text: typeof data?.text === 'string' ? data.text : '',
      pageCount: Number(data?.numpages ?? 0) || 0,
      title: data?.info?.Title || undefined,
    };
  }

  return { text: '', pageCount: 0 };
}

async function getPageCount(buf: Buffer): Promise<number> {
  try {
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    return 0;
  }
}

function meaningfulLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

export async function extractPdfText(filePath: string): Promise<ExtractPdfTextResult> {
  const buf = fs.readFileSync(filePath);
  let pageCount = await getPageCount(buf);

  let text = runPdftotext(filePath).trim();
  let method: PdfTextMethod = text ? 'pdftotext' : 'none';
  let title: string | undefined;

  if (meaningfulLength(text) < MIN_MEANINGFUL_CHARS) {
    const parsed = await runPdfParse(buf);
    const parsedText = parsed.text.trim();
    if (!pageCount) pageCount = parsed.pageCount;
    title = parsed.title;
    if (meaningfulLength(parsedText) >= meaningfulLength(text)) {
      text = parsedText;
      method = parsedText ? 'pdf-parse' : 'none';
    }
  }

  const isScanned = pageCount > 0 && meaningfulLength(text) < MIN_MEANINGFUL_CHARS;
  if (isScanned) {
    text = '';
    method = 'none';
  }

  return {
    text,
    pageCount,
    title,
    method,
    isScanned,
    ...(isScanned ? { nextAction: SCANNED_NEXT_ACTION } : {}),
  };
}
