---
name: document-analysis
description: Analyze a document end-to-end — read it with the right tool, extract text (OCR scanned PDFs), and produce a structured summary
---

# Document Analysis

**This skill EXECUTES the analysis. It is not a checklist to read back to the user.**
When you are given a document path, immediately run the tool chain below and
return the filled-in summary. Do not stop after loading this skill, and never
claim a document is "empty" or "analyzed" without having actually extracted its
content with the tools.

## Run this chain on the given file

1. **Identify the type** from the extension.

2. **Extract the content with the matching tool:**
   - **PDF** → `office-docs.read_pdf` for metadata (pages/title/dates; malformed
     fields come back as warnings, not errors), then `office-docs.extract_pdf_text`
     for the page text. For a large PDF it returns `textFile` (a .txt path) instead
     of inline `text` — `Read`/`Grep` that file to navigate the content by line.
   - **Word (.docx)** → `office-docs.read_document`.
   - **Excel (.xlsx/.csv)** → `office-docs.read_spreadsheet`.
   - **Image** → `image-reader.read_image` so the vision model can see it.

3. **Scanned / image-only PDF fallback.** If `extract_pdf_text` returns
   `isScanned: true` (no text layer), do NOT give up and do NOT just list page
   images. Follow its `nextAction`:
   - Render each page to an image — use the built-in `Read` tool on the `.pdf`,
     or `pdftoppm -jpeg <file> <out-prefix>` via Bash.
   - Call `image-reader.read_image` on each page image and read/OCR it with the
     vision model.
   - Assemble the per-page text into the document content before summarizing.

4. **Only after you have real content**, produce the summary.

## Output

- **Document Type** — report / article / manual / form / slides / etc.
- **Language**
- **Source** — extracted text layer, or OCR of scanned pages (say which)
- **Structure** — headings / sections / tables found
- **Key Points** — bullet list of the main content
- **Metadata** — author / date / version when available (note any unreadable fields)
