/**
 * Export a research report's markdown body to PDF via the browser's native
 * print dialog. We open a popup window with the rendered HTML + print
 * stylesheet, and trigger `window.print()` once the content is laid out.
 * The user picks "Save as PDF" in the system print dialog — no server-side
 * headless browser needed.
 */

export interface ExportReportPdfInput {
  /** Visible title that doubles as the PDF tab name. */
  title: string;
  /** Pre-rendered HTML (we expect ReactMarkdown's output piped through). */
  bodyHtml: string;
  /** Optional metadata shown at the top of the printable page. */
  meta?: Record<string, string | null | undefined>;
}

const PRINT_STYLESHEET = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 48px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
    color: #111;
    line-height: 1.6;
    background: #fff;
  }
  h1 { font-size: 22pt; margin: 0 0 8px; }
  h2 { font-size: 14pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
  h3 { font-size: 12pt; margin: 16px 0 6px; }
  p, li { font-size: 10.5pt; }
  ul, ol { padding-left: 22px; }
  code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  pre { background: #f3f3f3; padding: 10px 12px; border-radius: 4px; font-size: 9.5pt; overflow: auto; }
  a { color: #1d4ed8; text-decoration: underline; }
  blockquote { border-left: 3px solid #aaa; margin: 0; padding: 4px 12px; color: #555; }
  .meta { color: #666; font-size: 9pt; margin-bottom: 16px; }
  .meta div { margin: 2px 0; }
  @page { margin: 18mm; }
  @media print {
    .no-print { display: none !important; }
  }
`;

function renderMetaBlock(meta: Record<string, string | null | undefined> | undefined): string {
  if (!meta) return '';
  const rows = Object.entries(meta)
    .filter(([, v]) => v != null && String(v).length > 0)
    .map(
      ([k, v]) =>
        `<div><strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v))}</div>`,
    )
    .join('');
  return rows ? `<div class="meta">${rows}</div>` : '';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the full HTML document used inside the popup window. Exported pure
 * so unit tests can verify structure (title escape, meta rendering, stylesheet
 * inclusion) without running a real browser.
 */
export function buildPrintableHtml(input: ExportReportPdfInput): string {
  const safeTitle = escapeHtml(input.title);
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>${PRINT_STYLESHEET}</style>
</head>
<body>
<h1>${safeTitle}</h1>
${renderMetaBlock(input.meta)}
<div class="report-body">${input.bodyHtml}</div>
<script>
  // Wait one frame so layout settles before triggering print.
  requestAnimationFrame(() => {
    setTimeout(() => window.print(), 60);
  });
</script>
</body>
</html>`;
}

/**
 * Side-effecting browser entry point. Opens a popup, writes the HTML, lets
 * the browser auto-print. Returns false when the popup was blocked.
 */
export function openReportPrintWindow(input: ExportReportPdfInput): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return false;
  const html = buildPrintableHtml(input);
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
