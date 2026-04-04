import { HyperFormula } from 'hyperformula';

export interface FormulaSheetData {
  name?: string;
  data: (string | number | boolean | null)[][];
}

export interface FormulaRequest {
  formula: string;
  cell?: string;
}

export interface FormulaResult {
  formula: string;
  cell: string;
  value: string | number | boolean | null;
  error?: string;
}

export interface EvalFormulasResult {
  results: FormulaResult[];
  sheetName: string;
}

function parseCellAddress(addr: string): { row: number; col: number } | null {
  const match = addr.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const colStr = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  return { row: parseInt(match[2], 10) - 1, col: col - 1 };
}

export function evalFormulas(
  sheet: FormulaSheetData,
  formulas: FormulaRequest[],
): EvalFormulasResult {
  const sheetName = sheet.name || 'Sheet1';
  const hf = HyperFormula.buildFromSheets(
    { [sheetName]: sheet.data },
    { licenseKey: 'gpl-v3' },
  );

  const sheetId = hf.getSheetId(sheetName);
  if (sheetId === undefined) {
    throw new Error(`Sheet "${sheetName}" not found in HyperFormula engine`);
  }

  const results: FormulaResult[] = [];

  for (const req of formulas) {
    const targetCell = req.cell || findNextEmptyCell(sheet.data);
    const addr = parseCellAddress(targetCell);
    if (!addr) {
      results.push({
        formula: req.formula,
        cell: targetCell,
        value: null,
        error: `Invalid cell address: ${targetCell}`,
      });
      continue;
    }

    const formulaStr = req.formula.startsWith('=') ? req.formula : `=${req.formula}`;

    try {
      const changes = hf.setCellContents(
        { sheet: sheetId, row: addr.row, col: addr.col },
        [[formulaStr]],
      );

      const cellValue = hf.getCellValue({ sheet: sheetId, row: addr.row, col: addr.col });
      const normalized = normalizeCellValue(cellValue);

      results.push({
        formula: req.formula,
        cell: targetCell,
        value: normalized.value,
        error: normalized.error,
      });

      // Undo so next formula evaluates on original data
      if (changes.length > 0) {
        hf.setCellContents(
          { sheet: sheetId, row: addr.row, col: addr.col },
          [[sheet.data[addr.row]?.[addr.col] ?? null]],
        );
      }
    } catch (err) {
      results.push({
        formula: req.formula,
        cell: targetCell,
        value: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  hf.destroy();
  return { results, sheetName };
}

function findNextEmptyCell(data: (string | number | boolean | null)[][]): string {
  const row = data.length + 1;
  return `A${row}`;
}

function normalizeCellValue(value: unknown): { value: string | number | boolean | null; error?: string } {
  if (value === null || value === undefined) return { value: null };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { value };
  }
  if (typeof value === 'object' && value !== null && 'type' in value) {
    return { value: null, error: String((value as { type: string }).type) };
  }
  return { value: String(value) };
}

export function getSupportedFunctions(): string[] {
  const hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });
  const fns = hf.getRegisteredFunctionNames();
  hf.destroy();
  return fns;
}
