/**
 * PDF preview component
 * Uses react-pdf for rendering with continuous scroll
 */
'use client';

import { useState, useEffect } from 'react';
import { getFileUrl } from '@/lib/file-categories';

interface PdfPreviewProps {
  filePath: string;
  baseDir?: string;
}

const MAX_PAGES = 100; // Limit pages to prevent performance issues

export function PdfPreview({ filePath, baseDir }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [PdfComponents, setPdfComponents] = useState<any>(null);

  // Dynamically import react-pdf only on client side
  useEffect(() => {
    import('react-pdf').then((module) => {
      const { pdfjs } = module;
      // Use CDN for worker - most reliable approach
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      setPdfComponents(module);
    });
  }, []);

  const url = getFileUrl(filePath, baseDir);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setError(null);
  }

  function onDocumentLoadError(error: Error) {
    console.error('PDF load error:', error);
    setError('Failed to load PDF');
  }

  if (!PdfComponents) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading PDF viewer...
      </div>
    );
  }

  const { Document, Page } = PdfComponents;

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const isTruncated = numPages > MAX_PAGES;
  const pagesToRender = isTruncated ? MAX_PAGES : numPages;

  return (
    <div className="flex flex-col h-full">
      {/* Page info */}
      {numPages > 0 && (
        <div className="flex items-center justify-center gap-2 p-3 border-b border-border/40">
          <span className="text-sm text-muted-foreground">
            {numPages} {numPages === 1 ? 'page' : 'pages'}
          </span>
        </div>
      )}

      {/* Warning for large PDFs */}
      {isTruncated && (
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-950/20 border-b border-yellow-200 dark:border-yellow-900/30 text-sm text-yellow-800 dark:text-yellow-200">
          ⚠️ Large PDF detected. Showing first {MAX_PAGES} of {numPages} pages.
        </div>
      )}

      {/* PDF viewer - continuous scroll */}
      <div className="flex-1 overflow-auto">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              Loading PDF...
            </div>
          }
        >
          <div className="flex flex-col items-center gap-4 p-4">
            {Array.from(new Array(pagesToRender), (_, index) => (
              <div key={`page_${index + 1}`} className="shadow-lg">
                <Page
                  pageNumber={index + 1}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={
                    <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                      Loading page {index + 1}...
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
