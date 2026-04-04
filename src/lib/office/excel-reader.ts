import ExcelJS from 'exceljs';

export interface SheetData {
  name: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  formulas: { cell: string; formula: string }[];
}

export interface ReadExcelResult {
  fileName: string;
  sheetCount: number;
  sheets: SheetData[];
}

function cellValueToPlain(cell: ExcelJS.Cell): string | number | boolean | null {
  const { value } = cell;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'formula' in value) {
    const formulaVal = value as ExcelJS.CellFormulaValue;
    const r = formulaVal.result;
    if (r === null || r === undefined) return `=[${formulaVal.formula}]`;
    if (typeof r === 'object' && r !== null && 'error' in r) return `#${(r as ExcelJS.CellErrorValue).error}`;
    if (typeof r === 'string' || typeof r === 'number' || typeof r === 'boolean') return r;
    return String(r);
  }
  if (typeof value === 'object' && 'richText' in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join('');
  }
  if (typeof value === 'object' && 'text' in value) {
    return (value as ExcelJS.CellHyperlinkValue).text;
  }
  return String(value);
}

function extractCellFormula(cell: ExcelJS.Cell): string | null {
  const { value } = cell;
  if (value && typeof value === 'object' && 'formula' in value) {
    return (value as ExcelJS.CellFormulaValue).formula;
  }
  return null;
}

export async function readExcel(filePath: string, options?: {
  sheetName?: string;
  maxRows?: number;
}): Promise<ReadExcelResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const maxRows = options?.maxRows ?? 500;
  const sheets: SheetData[] = [];

  for (const worksheet of workbook.worksheets) {
    if (options?.sheetName && worksheet.name !== options.sheetName) continue;

    const headers: string[] = [];
    const rows: (string | number | boolean | null)[][] = [];
    const formulas: { cell: string; formula: string }[] = [];

    const rowCount = Math.min(worksheet.rowCount, maxRows);
    const colCount = worksheet.columnCount;

    for (let r = 1; r <= rowCount; r++) {
      const row = worksheet.getRow(r);
      const rowData: (string | number | boolean | null)[] = [];

      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        rowData.push(cellValueToPlain(cell));

        const formula = extractCellFormula(cell);
        if (formula) {
          formulas.push({ cell: cell.address, formula });
        }
      }

      if (r === 1) {
        headers.push(...rowData.map((v) => String(v ?? '')));
      }
      rows.push(rowData);
    }

    sheets.push({
      name: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: colCount,
      headers,
      rows,
      formulas,
    });
  }

  return {
    fileName: filePath.split('/').pop() || filePath,
    sheetCount: workbook.worksheets.length,
    sheets,
  };
}
