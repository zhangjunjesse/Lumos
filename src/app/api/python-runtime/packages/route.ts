import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { installPackage, uninstallPackage, listPackages, ensureVenv } from '@/lib/python-venv';
import { dataDir } from '@/lib/db/connection';

const SCRIPTS_DIR = path.join(dataDir, 'mcp-scripts');

/**
 * POST /api/python-runtime/packages
 *
 * Actions:
 *   { action: "init" }                        — 初始化 venv
 *   { action: "install", package: "xxx" }      — 安装 pip 包
 *   { action: "uninstall", package: "xxx" }    — 卸载 pip 包
 *   { action: "write-script", name: "x", content: "..." } — 写 Python 脚本文件
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'init') {
      const pythonPath = await ensureVenv();
      return NextResponse.json({ success: true, pythonPath });
    }

    if (action === 'write-script') {
      const { name, content } = body;
      if (!name || typeof name !== 'string' || !content || typeof content !== 'string') {
        return NextResponse.json({ error: 'Missing name or content' }, { status: 400 });
      }
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
      const scriptPath = path.join(SCRIPTS_DIR, `${safeName}.py`);
      fs.writeFileSync(scriptPath, content, 'utf-8');
      fs.chmodSync(scriptPath, 0o755);
      return NextResponse.json({ success: true, scriptPath });
    }

    const packageName = body.package;
    if (!packageName || typeof packageName !== 'string') {
      return NextResponse.json({ error: 'Missing required field: package' }, { status: 400 });
    }

    const safeName = packageName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\[\]-]*$/.test(safeName)) {
      return NextResponse.json({ error: 'Invalid package name' }, { status: 400 });
    }

    if (action === 'install') {
      const { stdout, stderr } = await installPackage(safeName);
      const packages = await listPackages();
      return NextResponse.json({ success: true, stdout, stderr, packages });
    }

    if (action === 'uninstall') {
      const { stdout, stderr } = await uninstallPackage(safeName);
      const packages = await listPackages();
      return NextResponse.json({ success: true, stdout, stderr, packages });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "install", "uninstall", "init", or "write-script".' },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Package operation failed' },
      { status: 500 },
    );
  }
}
