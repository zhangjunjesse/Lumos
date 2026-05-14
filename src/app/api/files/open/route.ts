import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import nodePath from 'path';
import { WINDOWS_ACCOUNTS_FILE } from '@/lib/wechat-export/setup-state';

function isAllowedWeChatExportPath(filePath: string): boolean {
  try {
    if (!fs.existsSync(WINDOWS_ACCOUNTS_FILE)) return false;
    const accounts = JSON.parse(fs.readFileSync(WINDOWS_ACCOUNTS_FILE, 'utf8')) as Array<{ wx_dir?: string }>;
    return accounts.some((account) => {
      if (!account.wx_dir) return false;
      const root = nodePath.normalize(nodePath.resolve(account.wx_dir)).toLowerCase();
      const target = nodePath.normalize(filePath).toLowerCase();
      return target === root || target.startsWith(root + nodePath.sep);
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const { path: requestedPath, scope } = await req.json();
  if (!requestedPath || typeof requestedPath !== 'string') {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }
  const resolvedPath = nodePath.resolve(requestedPath);

  if (scope === 'wechat-export' && process.platform === 'win32' && !isAllowedWeChatExportPath(resolvedPath)) {
    return NextResponse.json({ error: 'Path is outside the allowed WeChat data directories' }, { status: 403 });
  }

  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open';
    args = [resolvedPath];
  } else if (platform === 'win32') {
    cmd = 'explorer.exe';
    args = [resolvedPath];
  } else {
    cmd = 'xdg-open';
    args = [resolvedPath];
  }

  return new Promise<NextResponse>((resolve) => {
    execFile(cmd, args, (err) => {
      if (err) {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      } else {
        resolve(NextResponse.json({ ok: true }));
      }
    });
  });
}
