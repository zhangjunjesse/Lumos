import { NextRequest, NextResponse } from 'next/server';
import * as wsStore from '@/lib/stores/workspace-store';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/workspaces/[id]/preview
 * Pre-scan: return file count and type distribution without persisting.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = wsStore.getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!fs.existsSync(ws.path)) {
    return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
  }

  const includes: string[] = JSON.parse(ws.include_patterns);
  const extSet = new Set<string>();
  for (const pat of includes) {
    const m = pat.match(/\*\.(\w+)/);
    if (m) extSet.add(`.${m[1]}`);
  }

  let fileCount = 0;
  const typeDist: Record<string, number> = {};

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (extSet.size === 0 || extSet.has(ext)) {
          fileCount++;
          typeDist[ext] = (typeDist[ext] || 0) + 1;
        }
      }
    }
  }

  walk(ws.path);
  return NextResponse.json({ file_count: fileCount, type_distribution: typeDist });
}
