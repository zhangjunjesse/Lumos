import ExcelJS from 'exceljs';

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
  numFmt?: string;
  alignment?: 'left' | 'center' | 'right';
  wrapText?: boolean;
}

export interface WriteSheetData {
  name: string;
  headers?: string[];
  rows: (string | number | boolean | null)[][];
  formulas?: { cell: string; formula: string }[];
  styles?: { cell: string; style: CellStyle }[];
  columnWidths?: number[];
}

export interface WriteExcelOptions {
  filePath: string;
  sheets: WriteSheetData[];
}

function applyStyle(cell: ExcelJS.Cell, style: CellStyle): void {
  const font: Partial<ExcelJS.Font> = {};
  if (style.bold !== undefined) font.bold = style.bold;
  if (style.italic !== undefined) font.italic = style.italic;
  if (style.fontSize !== undefined) font.size = style.fontSize;
  if (style.fontColor) font.color = { argb: style.fontColor.replace('#', 'FF') };
  if (Object.keys(font).length > 0) cell.font = font;

  if (style.bgColor) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: style.bgColor.replace('#', 'FF') },
    };
  }
  if (style.numFmt) cell.numFmt = style.numFmt;
  if (style.alignment || style.wrapText) {
    cell.alignment = {
      horizontal: style.alignment,
      wrapText: style.wrapText,
    };
  }
}

function parseCellAddress(addr: string): { row: number; col: number } {
  const match = addr.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { row: 1, col: 1 };
  const colStr = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  return { row: parseInt(match[2], 10), col };
}

export async function writeExcel(options: WriteExcelOptions): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Lumos';
  workbook.created = new Date();

  for (const sheetData of options.sheets) {
    const ws = workbook.addWorksheet(sheetData.name);

    if (sheetData.columnWidths) {
      ws.columns = sheetData.columnWidths.map((w) => ({ width: w }));
    }

    let startRow = 1;
    if (sheetData.headers && sheetData.headers.length > 0) {
      const headerRow = ws.getRow(1);
      sheetData.headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
      });
      headerRow.commit();
      startRow = 2;
    }

    for (let r = 0; r < sheetData.rows.length; r++) {
      const row = ws.getRow(startRow + r);
      const data = sheetData.rows[r];
      for (let c = 0; c < data.length; c++) {
        row.getCell(c + 1).value = data[c] as ExcelJS.CellValue;
      }
      row.commit();
    }

    if (sheetData.formulas) {
      for (const f of sheetData.formulas) {
        const { row, col } = parseCellAddress(f.cell);
        ws.getCell(row, col).value = { formula: f.formula } as ExcelJS.CellValue;
      }
    }

    if (sheetData.styles) {
      for (const s of sheetData.styles) {
        const { row, col } = parseCellAddress(s.cell);
        applyStyle(ws.getCell(row, col), s.style);
      }
    }
  }

  await workbook.xlsx.writeFile(options.filePath);
  return options.filePath;
}
