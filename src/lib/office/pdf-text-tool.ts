import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { extractPdfText, type PdfTextMethod } from './pdf-text';

// Tool-facing wrapper around the pure `extractPdfText`. A 300-page PDF extracts
// to ~500KB of text; returning that inline makes the agent runtime offload the
// whole tool result to a single-line JSON blob that Read (256KB cap) can't open
// and Grep/offset can't navigate. So: small docs return text inline; large docs
// get their full text written to a real multi-line .txt the agent can Read/Grep
// directly, and the result carries the file path + a preview instead of the bulk.
//
// `extractPdfText` itself stays pure — the knowledge pipeline keeps consuming the
// full text in-process. This module owns only the persistence/shape decision.

// Stay well under the Read 256KB limit and below the runtime's offload threshold,
// while still inlining short docs for convenience.
const MAX_INLINE_CHARS = 12_000;
const PREVIEW_CHARS = 1_200;

export interface PdfTextToolResult {
  pageCount: number;
  charCount: number;
  isScanned: boolean;
  method: PdfTextMethod;
  title?: string;
  nextAction?: string;
  /** Full text, inlined when the document is small enough. */
  text?: string;
  /** Path to a multi-line .txt holding the full text, when the document is large. */
  textFile?: string;
  /** Leading slice of the text, so the agent sees the start without opening the file. */
  preview?: string;
  /** Human-readable pointer when the text was offloaded to a file. */
  note?: string;
}

function resolveDataDir(): string {
  return process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
}

// Path is keyed on file identity (path + size + mtime) so re-extracting the same
// unchanged PDF reuses one file instead of piling up duplicates.
function sidecarPath(absFilePath: string): string {
  const stat = fs.statSync(absFilePath);
  const key = `${absFilePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  const base = path.basename(absFilePath, path.extname(absFilePath))
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40) || 'pdf';
  return path.join(resolveDataDir(), 'pdf-extracts', `${base}.${hash}.txt`);
}

export async function extractPdfTextForAgent(filePath: string): Promise<PdfTextToolResult> {
  const r = await extractPdfText(filePath);
  const base: PdfTextToolResult = {
    pageCount: r.pageCount,
    charCount: r.text.length,
    isScanned: r.isScanned,
    method: r.method,
    ...(r.title ? { title: r.title } : {}),
    ...(r.nextAction ? { nextAction: r.nextAction } : {}),
  };

  // Scanned / no text layer: nothing to inline or offload.
  if (!r.text) return base;

  if (r.text.length <= MAX_INLINE_CHARS) {
    return { ...base, text: r.text };
  }

  const outPath = sidecarPath(filePath);
  if (!fs.existsSync(outPath)) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, r.text, 'utf8');
  }
  return {
    ...base,
    textFile: outPath,
    preview: r.text.slice(0, PREVIEW_CHARS),
    note: `Full extracted text (${r.text.length} chars) saved to ${outPath}. `
      + 'Read or Grep that .txt file directly — the full text is intentionally not inlined here.',
  };
}
