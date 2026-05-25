import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources';

// pdf-lib's built-in fonts (Helvetica et al.) use WinAnsi encoding and cannot
// render anything outside Latin-1. The previous implementation would throw
// `WinAnsi cannot encode "X"` the moment a single CJK character appeared in a
// transcript or note. We bundle Noto Sans CJK SC as a fallback and embed it
// on demand. Noto covers CJK + Latin + kana with a single TTF, so a doc that
// contains any CJK can render the entire page from this one font without
// having to segment per-glyph at draw time.
const CJK_FONT_RESOURCE = 'fonts/NotoSansCJKsc-Regular.otf';
const CJK_CHAR_REGEX = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

export function containsCjk(text: string): boolean {
  return CJK_CHAR_REGEX.test(text);
}

let cachedCjkFontBytes: Uint8Array | null | undefined;

function loadCjkFontBytes(): Uint8Array | null {
  if (cachedCjkFontBytes !== undefined) return cachedCjkFontBytes;
  const fontPath = resolveRuntimeResourcePath(CJK_FONT_RESOURCE);
  if (!fontPath) {
    cachedCjkFontBytes = null;
    return null;
  }
  try {
    cachedCjkFontBytes = fs.readFileSync(fontPath);
  } catch {
    cachedCjkFontBytes = null;
  }
  return cachedCjkFontBytes;
}

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
}

export interface ReadPdfResult {
  fileName: string;
  pageCount: number;
  pages: PdfPageInfo[];
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
}

export interface PdfTextBlock {
  text: string;
  fontSize?: number;
  x?: number;
  y?: number;
  bold?: boolean;
  color?: { r: number; g: number; b: number };
}

export interface PdfPageContent {
  blocks: PdfTextBlock[];
}

export interface CreatePdfOptions {
  filePath: string;
  title?: string;
  pages: PdfPageContent[];
  pageSize?: { width: number; height: number };
}

export async function readPdfInfo(filePath: string): Promise<ReadPdfResult> {
  const bytes = fs.readFileSync(filePath);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const pages = pdf.getPages().map((page, i) => ({
    pageNumber: i + 1,
    width: page.getWidth(),
    height: page.getHeight(),
  }));

  return {
    fileName: filePath.split('/').pop() || filePath,
    pageCount: pdf.getPageCount(),
    pages,
    metadata: {
      title: pdf.getTitle(),
      author: pdf.getAuthor(),
      subject: pdf.getSubject(),
      creator: pdf.getCreator(),
      producer: pdf.getProducer(),
      creationDate: pdf.getCreationDate()?.toISOString(),
      modificationDate: pdf.getModificationDate()?.toISOString(),
    },
  };
}

export async function createPdf(options: CreatePdfOptions): Promise<string> {
  const pdf = await PDFDocument.create();
  if (options.title) pdf.setTitle(options.title);
  pdf.setCreator('Lumos');

  const needsCjk = (options.title && containsCjk(options.title))
    || options.pages.some(p => p.blocks.some(b => containsCjk(b.text)));

  let font: PDFFont;
  let fontBold: PDFFont;
  if (needsCjk) {
    const cjkBytes = loadCjkFontBytes();
    if (!cjkBytes) {
      throw new Error('CJK content requested but Noto Sans CJK font is not bundled at resources/fonts/NotoSansCJKsc-Regular.otf');
    }
    pdf.registerFontkit(fontkit);
    // Noto SC ships only Regular in this bundle; we route both regular and
    // bold to the same face. Embedding twice would just bloat the PDF.
    const noto = await pdf.embedFont(cjkBytes, { subset: true });
    font = noto;
    fontBold = noto;
  } else {
    font = await pdf.embedFont(StandardFonts.Helvetica);
    fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }

  const pw = options.pageSize?.width ?? 595;
  const ph = options.pageSize?.height ?? 842;

  for (const pageContent of options.pages) {
    const page = pdf.addPage([pw, ph]);
    let cursorY = ph - 50;

    for (const block of pageContent.blocks) {
      const size = block.fontSize ?? 12;
      const f = block.bold ? fontBold : font;
      const color = block.color ? rgb(block.color.r, block.color.g, block.color.b) : rgb(0, 0, 0);

      const lines = wrapText(block.text, f, size, pw - 100);
      for (const line of lines) {
        if (cursorY < 50) break;
        page.drawText(line, {
          x: block.x ?? 50,
          y: cursorY,
          size,
          font: f,
          color,
        });
        cursorY -= size * 1.4;
      }
    }
  }

  const bytes = await pdf.save();
  fs.writeFileSync(options.filePath, bytes);
  return options.filePath;
}

export async function mergePdfs(filePaths: string[], outputPath: string): Promise<string> {
  const merged = await PDFDocument.create();

  for (const fp of filePaths) {
    const bytes = fs.readFileSync(fp);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  const bytes = await merged.save();
  fs.writeFileSync(outputPath, bytes);
  return outputPath;
}

export async function splitPdf(
  filePath: string,
  outputDir: string,
  pageRanges: { start: number; end: number }[],
): Promise<string[]> {
  const bytes = fs.readFileSync(filePath);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outputs: string[] = [];

  for (let i = 0; i < pageRanges.length; i++) {
    const range = pageRanges[i];
    const newPdf = await PDFDocument.create();
    const indices = [];
    for (let p = range.start - 1; p < Math.min(range.end, src.getPageCount()); p++) {
      indices.push(p);
    }
    const pages = await newPdf.copyPages(src, indices);
    for (const page of pages) {
      newPdf.addPage(page);
    }
    const outPath = `${outputDir}/split_${i + 1}.pdf`;
    fs.writeFileSync(outPath, await newPdf.save());
    outputs.push(outPath);
  }

  return outputs;
}

// Wrap text to fit `maxWidth`. We try whitespace-delimited words first (the
// natural unit for Latin), but fall back to per-character wrapping for any
// token that itself overflows — that's the case for CJK lines, which have no
// inter-character spaces and would otherwise be treated as one giant "word"
// and silently truncated.
export function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  const flush = (line: string) => { if (line) lines.push(line); };
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= maxWidth;

  const breakByChar = (token: string): { remaining: string; flushed: string[] } => {
    const flushed: string[] = [];
    let cur = '';
    for (const ch of token) {
      const candidate = cur ? `${cur}${ch}` : ch;
      if (!fits(candidate) && cur) {
        flushed.push(cur);
        cur = ch;
      } else {
        cur = candidate;
      }
    }
    return { remaining: cur, flushed };
  };

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }

    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (fits(candidate)) { current = candidate; continue; }

      // candidate overflows: flush current, then try the bare word
      if (current) flush(current);
      if (fits(word)) {
        current = word;
      } else {
        // word itself is too wide (typically CJK) — break per-character
        const { remaining, flushed } = breakByChar(word);
        for (const l of flushed) flush(l);
        current = remaining;
      }
    }
    if (current) flush(current);
  }
  return lines.length > 0 ? lines : [''];
}
