import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import fs from 'fs';

export interface DocParagraph {
  text: string;
  heading?: 'h1' | 'h2' | 'h3';
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  alignment?: 'left' | 'center' | 'right';
}

export interface DocTable {
  headers: string[];
  rows: string[][];
}

export interface DocSection {
  paragraphs?: DocParagraph[];
  table?: DocTable;
}

export interface WriteWordOptions {
  filePath: string;
  title?: string;
  sections: DocSection[];
}

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
};

const ALIGN_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

function buildParagraph(p: DocParagraph): Paragraph {
  return new Paragraph({
    heading: p.heading ? HEADING_MAP[p.heading] : undefined,
    alignment: p.alignment ? ALIGN_MAP[p.alignment] : undefined,
    children: [
      new TextRun({
        text: p.text,
        bold: p.bold,
        italics: p.italic,
        size: p.fontSize ? p.fontSize * 2 : undefined,
      }),
    ],
  });
}

function buildTable(t: DocTable): Table {
  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: '999999',
  };
  const borders = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  const headerRow = new TableRow({
    children: t.headers.map(
      (h) =>
        new TableCell({
          borders,
          width: { size: Math.floor(9000 / t.headers.length), type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        }),
    ),
  });

  const dataRows = t.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              borders,
              children: [new Paragraph(cell)],
            }),
        ),
      }),
  );

  return new Table({ rows: [headerRow, ...dataRows] });
}

export async function writeWord(options: WriteWordOptions): Promise<string> {
  const children: (Paragraph | Table)[] = [];

  if (options.title) {
    children.push(buildParagraph({ text: options.title, heading: 'h1' }));
  }

  for (const section of options.sections) {
    if (section.paragraphs) {
      for (const p of section.paragraphs) {
        children.push(buildParagraph(p));
      }
    }
    if (section.table) {
      children.push(buildTable(section.table));
    }
  }

  const doc = new Document({
    creator: 'Lumos',
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(options.filePath, buffer);
  return options.filePath;
}
