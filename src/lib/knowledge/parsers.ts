/**
 * Document parsers — unified text extraction for Word/Excel/PDF/TXT/MD
 * Returns structured ParsedDocument with title, content, metadata
 */
import fs from 'fs';
import path from 'path';
import type { ParsedDocument, DocumentMetadata } from './types';

const MIME_MAP: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

/** Extract text content from a file (backward-compatible) */
export async function parseFile(filePath: string): Promise<string> {
  const doc = await parseDocument(filePath);
  return doc.content;
}

/** Parse file into structured document with metadata */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const baseName = path.basename(filePath, ext);

  const base: DocumentMetadata = {
    wordCount: 0,
    charCount: 0,
    fileSize: stat.size,
    mimeType: MIME_MAP[ext] || 'application/octet-stream',
  };

  let result: { title: string; content: string; extra: Partial<DocumentMetadata> };

  if (ext === '.docx') {
    result = await parseDocx(filePath, baseName);
  } else if (ext === '.xlsx' || ext === '.xls') {
    result = await parseExcel(filePath, baseName);
  } else if (ext === '.pdf') {
    result = await parsePdf(filePath, baseName);
  } else {
    result = parsePlainText(filePath, baseName);
  }

  const content = result.content;
  const metadata: DocumentMetadata = {
    ...base,
    ...result.extra,
    wordCount: countWords(content),
    charCount: content.length,
  };

  return { title: result.title, content, metadata };
}

/** Count words (handles both CJK and Latin text) */
function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0;
  const latin = text.match(/[a-zA-Z]+/g)?.length || 0;
  return cjk + latin;
}

/** Extract title from markdown (first heading or first line) */
function extractMdTitle(content: string, fallback: string): string {
  const headingMatch = content.match(/^#\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = content.split('\n').find(l => l.trim());
  return firstLine?.slice(0, 60) || fallback;
}

type ParseResult = { title: string; content: string; extra: Partial<DocumentMetadata> };

async function parseDocx(filePath: string, baseName: string): Promise<ParseResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  const content = result.value;
  return { title: baseName, content, extra: {} };
}

async function parseExcel(filePath: string, baseName: string): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    if (csv.trim()) parts.push(`## ${name}\n${csv}`);
  }
  return {
    title: baseName,
    content: parts.join('\n\n'),
    extra: { sheetNames: wb.SheetNames },
  };
}

async function parsePdf(filePath: string, baseName: string): Promise<ParseResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = (await import('pdf-parse' as any)).default;
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  return {
    title: data.info?.Title || baseName,
    content: data.text,
    extra: { pageCount: data.numpages },
  };
}

function parsePlainText(filePath: string, baseName: string): ParseResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const title = ext === '.md' ? extractMdTitle(content, baseName) : baseName;
  return { title, content, extra: {} };
}
