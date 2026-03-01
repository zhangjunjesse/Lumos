import { NextRequest, NextResponse } from 'next/server';
import * as docStore from '@/lib/stores/document-store';
import path from 'path';
import fs from 'fs';
import os from 'os';

const UPLOAD_DIR = path.join(
  process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'uploads',
);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = new Set([
  '.md', '.txt', '.docx', '.pdf', '.xlsx', '.csv', '.json', '.html', '.htm',
]);

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  // S5: File size validation
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 413 });
  }

  // S6: Extension allowlist
  const ext = path.extname(file.name).toLowerCase() || '.md';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
      { status: 400 },
    );
  }

  // Save file to disk
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = path.join(UPLOAD_DIR, safeName);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buf);

  // Determine format from extension
  const formatMap: Record<string, string> = {
    '.md': 'markdown', '.txt': 'plaintext',
    '.docx': 'docx', '.pdf': 'pdf', '.xlsx': 'xlsx',
  };
  const format = formatMap[ext] || 'plaintext';
  const title = path.basename(file.name, ext);

  // Create document record (parsing happens async later)
  const needsParsing = ['docx', 'pdf', 'xlsx'].includes(format);
  const doc = docStore.createDocument({
    title,
    content: needsParsing ? '' : buf.toString('utf-8'),
    format,
    source_type: 'upload',
    source_path: filePath,
  });

  if (needsParsing) {
    docStore.updateDocument(doc.id, { status: 'parsing' });
  }

  return NextResponse.json(doc);
}
