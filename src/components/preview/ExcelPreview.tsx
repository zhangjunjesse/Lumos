/**
 * Excel spreadsheet preview component
 * Uses xlsx library to parse and display sheets with lazy loading
 */
'use client';

import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';

interface ExcelPreviewProps {
  filePath: string;
  baseDir?: string;
}

const MAX_ROWS = 1000; // Limit rows to prevent performance issues

export function ExcelPreview({ filePath, baseDir }: ExcelPreviewProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSpreadsheet() {
      setLoading(true);
      setError(null);

      try {
        // Fetch the Excel file as ArrayBuffer
        const params = new URLSearchParams({ path: filePath });
        if (baseDir) params.set('baseDir', baseDir);

        const response = await fetch(`/api/files/raw?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch spreadsheet');

        const arrayBuffer = await response.arrayBuffer();

        // Parse with xlsx - only parse structure, not all sheets
        // Use sheetStubs: true to avoid parsing all cell data immediately
        const wb = XLSX.read(arrayBuffer, {
          type: 'array',
          sheetStubs: false, // Don't create stubs for empty cells
          cellStyles: false, // Don't parse styles
          cellDates: false,  // Don't parse dates
        });

        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        setActiveSheet(wb.SheetNames[0] || '');
      } catch (err) {
        console.error('Excel preview error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load spreadsheet';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    loadSpreadsheet();
  }, [filePath, baseDir]);

  // Memoize HTML conversion to avoid re-rendering on every state change
  // Only convert the active sheet, not all sheets
  const { htmlTable, rowCount, isTruncated } = useMemo(() => {
    if (!workbook || !activeSheet) {
      return { htmlTable: '', rowCount: 0, isTruncated: false };
    }

    const sheet = workbook.Sheets[activeSheet];
    if (!sheet || !sheet['!ref']) {
      return { htmlTable: '<p>Empty sheet</p>', rowCount: 0, isTruncated: false };
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const totalRows = range.e.r - range.s.r + 1;
    const isTruncated = totalRows > MAX_ROWS;

    // Create a copy of the sheet to avoid modifying the original
    const sheetCopy = { ...sheet };

    // Limit rows for performance
    if (isTruncated) {
      const limitedRange = { ...range, e: { ...range.e, r: range.s.r + MAX_ROWS - 1 } };
      sheetCopy['!ref'] = XLSX.utils.encode_range(limitedRange);
    }

    const html = XLSX.utils.sheet_to_html(sheetCopy, { id: 'excel-table' });

    return {
      htmlTable: html,
      rowCount: totalRows,
      isTruncated
    };
  }, [workbook, activeSheet]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-2">
        <div className="text-sm text-muted-foreground">Loading spreadsheet...</div>
        <div className="text-xs text-muted-foreground/60">This may take a moment for large files</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!workbook || !activeSheet) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        No sheets found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sheet tabs */}
      {sheetNames.length > 1 && (
        <div className="flex gap-1 p-2 border-b border-border/40 overflow-x-auto">
          {sheetNames.map((name) => (
            <Button
              key={name}
              variant={name === activeSheet ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveSheet(name)}
              className="shrink-0"
            >
              {name}
            </Button>
          ))}
        </div>
      )}

      {/* Warning for large files */}
      {isTruncated && (
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-950/20 border-b border-yellow-200 dark:border-yellow-900/30 text-sm text-yellow-800 dark:text-yellow-200">
          ⚠️ Large spreadsheet detected. Showing first {MAX_ROWS} of {rowCount} rows.
        </div>
      )}

      {/* Table view */}
      <div className="flex-1 overflow-auto p-4">
        <div
          className="[&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-border/40 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_th]:border [&_th]:border-border/40 [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-sm [&_th]:font-medium"
          dangerouslySetInnerHTML={{ __html: htmlTable }}
        />
      </div>
    </div>
  );
}
