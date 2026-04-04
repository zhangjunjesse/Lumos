export const TOOLS = [
  {
    name: 'read_spreadsheet',
    description: 'Read an Excel (.xlsx) file. Returns sheet names, headers, cell data, and formulas.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the .xlsx file' },
        sheetName: { type: 'string', description: 'Read only this sheet (optional)' },
        maxRows: { type: 'integer', description: 'Max rows to read per sheet (default 500)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'write_spreadsheet',
    description: 'Create or overwrite an Excel (.xlsx) file with data, formulas, and styles.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Output .xlsx path' },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array' } },
              formulas: { type: 'array', items: { type: 'object', properties: { cell: { type: 'string' }, formula: { type: 'string' } }, required: ['cell', 'formula'] } },
              styles: { type: 'array', items: { type: 'object' } },
              columnWidths: { type: 'array', items: { type: 'number' } },
            },
            required: ['name', 'rows'],
          },
        },
      },
      required: ['filePath', 'sheets'],
    },
  },
  {
    name: 'eval_formulas',
    description: 'Evaluate Excel formulas on given data using HyperFormula engine. Supports 398 built-in functions (SUM, VLOOKUP, IF, INDEX/MATCH, etc).',
    inputSchema: {
      type: 'object',
      properties: {
        sheet: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            data: { type: 'array', items: { type: 'array' }, description: '2D array of cell values' },
          },
          required: ['data'],
        },
        formulas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              formula: { type: 'string', description: 'Excel formula (e.g. "=SUM(A1:A10)")' },
              cell: { type: 'string', description: 'Target cell address (e.g. "B11")' },
            },
            required: ['formula'],
          },
        },
      },
      required: ['sheet', 'formulas'],
    },
  },
  {
    name: 'read_document',
    description: 'Read a Word (.docx) file. Returns extracted text and HTML representation.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the .docx file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a Word (.docx) file with headings, paragraphs, and tables.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Output .docx path' },
        title: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              paragraphs: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, heading: { type: 'string', enum: ['h1', 'h2', 'h3'] }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, fontSize: { type: 'number' }, alignment: { type: 'string', enum: ['left', 'center', 'right'] } }, required: ['text'] } },
              table: { type: 'object', properties: { headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, required: ['headers', 'rows'] },
            },
          },
        },
      },
      required: ['filePath', 'sections'],
    },
  },
  {
    name: 'read_pdf',
    description: 'Read PDF metadata only: page count, page dimensions, title, author, dates. Does NOT extract text content from pages.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the .pdf file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'create_pdf',
    description: 'Create a PDF file with text content.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Output .pdf path' },
        title: { type: 'string' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              blocks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, fontSize: { type: 'number' }, bold: { type: 'boolean' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['text'] } },
            },
            required: ['blocks'],
          },
        },
      },
      required: ['filePath', 'pages'],
    },
  },
  {
    name: 'merge_pdfs',
    description: 'Merge multiple PDF files into one.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, description: 'PDF file paths to merge' },
        outputPath: { type: 'string', description: 'Output merged PDF path' },
      },
      required: ['filePaths', 'outputPath'],
    },
  },
  {
    name: 'split_pdf',
    description: 'Split a PDF into multiple files by page ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        outputDir: { type: 'string', description: 'Directory for split output files' },
        pageRanges: { type: 'array', items: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } }, required: ['start', 'end'] } },
      },
      required: ['filePath', 'outputDir', 'pageRanges'],
    },
  },
  {
    name: 'create_presentation',
    description: 'Create a PowerPoint (.pptx) file with slides containing text and tables.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Output .pptx path' },
        title: { type: 'string' },
        author: { type: 'string' },
        layout: { type: 'string', enum: ['16x9', '4x3'] },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              texts: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, fontSize: { type: 'number' }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, color: { type: 'string' }, align: { type: 'string', enum: ['left', 'center', 'right'] }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['text'] } },
              table: { type: 'object', properties: { headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, required: ['headers', 'rows'] },
              background: { type: 'object', properties: { color: { type: 'string' } } },
            },
          },
        },
      },
      required: ['filePath', 'slides'],
    },
  },
];
