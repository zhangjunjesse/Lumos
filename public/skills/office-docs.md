---
name: office-docs
description: Process Office documents — Excel (read/write with formulas), Word, PDF, PowerPoint
---

You have access to the `office-docs` MCP tools for processing Office documents. Use these tools when users need to work with spreadsheets, documents, PDFs, or presentations.

## Available Tools

### Excel
- **read_spreadsheet** — Read .xlsx files: cell data, formulas, headers, sheet names
- **write_spreadsheet** — Create .xlsx with data, formulas (=SUM, =VLOOKUP, etc), styles (bold, colors, number formats), column widths
- **eval_formulas** — Evaluate Excel formulas on data in-memory using HyperFormula (398 built-in functions: SUM, IF, VLOOKUP, INDEX, MATCH, SUMIF, COUNTIF, etc)

### Word
- **read_document** — Read .docx files: extract text and HTML
- **create_document** — Create .docx with headings (h1/h2/h3), paragraphs (bold, italic, alignment), and tables

### PDF
- **read_pdf** — Read PDF metadata: pages, dimensions, title, author
- **create_pdf** — Create PDF with text blocks (font size, bold, color, positioning)
- **merge_pdfs** — Merge multiple PDFs into one
- **split_pdf** — Split PDF by page ranges

### PowerPoint
- **create_presentation** — Create .pptx with slides containing titles, subtitles, text blocks, and tables. Supports 16:9 and 4:3 layouts.

## Best Practices
1. Always use absolute file paths
2. For Excel formulas, use standard Excel syntax (e.g. `=SUM(A1:A10)`, `=VLOOKUP(E2,A:B,2,FALSE)`)
3. When reading large spreadsheets, use `maxRows` to limit data
4. For PDF text extraction, note that pdf-lib reads metadata only — use `read_document` for Word content extraction
