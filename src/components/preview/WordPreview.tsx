/**
 * Word document preview component
 * Uses mammoth to convert .docx to HTML
 */
'use client';

import { useState, useEffect } from 'react';
import mammoth from 'mammoth';

interface WordPreviewProps {
  filePath: string;
  baseDir?: string;
}

export function WordPreview({ filePath, baseDir }: WordPreviewProps) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDocument() {
      setLoading(true);
      setError(null);

      try {
        // Fetch the .docx file as ArrayBuffer
        const params = new URLSearchParams({ path: filePath });
        if (baseDir) params.set('baseDir', baseDir);

        const response = await fetch(`/api/files/raw?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch document');

        const arrayBuffer = await response.arrayBuffer();

        // Convert to HTML using mammoth
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setHtml(result.value);

        // Log any warnings
        if (result.messages.length > 0) {
          console.warn('Mammoth conversion warnings:', result.messages);
        }
      } catch (err) {
        console.error('Word preview error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load document';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    loadDocument();
  }, [filePath, baseDir]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading document...
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

  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none p-6 overflow-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
