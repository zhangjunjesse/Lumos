import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';

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

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
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

function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}
