import { NextResponse } from 'next/server';
import { findClaudeBinary, getClaudeVersion, getExpandedPath } from '@/lib/platform';
import fs from 'fs';
import path from 'path';
import os from 'os';

/** Find the SDK's bundled cli.js (same logic as claude-client.ts) */
function findBundledCliPath(): string | undefined {
  // 1. process.cwd() — most reliable in packaged Electron app
  const cwdCandidate = path.join(
    process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
  );
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;

  // 2. require.resolve — works in dev mode (webpack compiles this away in production)
  try {
    const sdkPkg = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    if (typeof sdkPkg === 'string' && sdkPkg.includes('claude-agent-sdk')) {
      const cliPath = path.join(path.dirname(sdkPkg), 'cli.js');
      if (fs.existsSync(cliPath)) return cliPath;
    }
  } catch { /* SDK not resolvable */ }

  return undefined;
}

/** Check if a node binary is version >= 18 */
function isNodeVersionOk(nodePath: string): boolean {
  try {
    const { execFileSync } = require('child_process');
    const ver = execFileSync(nodePath, ['--version'], {
      timeout: 3000, encoding: 'utf-8', stdio: 'pipe',
    }).toString().trim();
    const major = parseInt(ver.replace(/^v/, ''), 10);
    return major >= 18;
  } catch { return false; }
}

/** Find system node binary >= 18 (same logic as claude-client.ts) */
function findSystemNode(): string | undefined {
  const candidates: string[] = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    candidates.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'));
  } else {
    const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
    candidates.push(path.join(nvmDir, 'current', 'bin', 'node'));
    // Scan nvm versions directory (newest first)
    try {
      const versionsDir = path.join(nvmDir, 'versions', 'node');
      if (fs.existsSync(versionsDir)) {
        const versions = fs.readdirSync(versionsDir)
          .filter(v => v.startsWith('v'))
          .sort((a, b) => {
            const pa = a.replace('v', '').split('.').map(Number);
            const pb = b.replace('v', '').split('.').map(Number);
            for (let i = 0; i < 3; i++) {
              if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
            }
            return 0;
          });
        for (const v of versions) {
          candidates.push(path.join(versionsDir, v, 'bin', 'node'));
        }
      }
    } catch { /* skip */ }
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (dir.includes('.nvm/versions/node')) candidates.push(path.join(dir, 'node'));
    }
    candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node');
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p) && isNodeVersionOk(p)) return p; } catch { /* skip */ }
  }
  return undefined;
}

export async function GET() {
  try {
    const claudePath = findClaudeBinary();
    const bundledCli = findBundledCliPath();
    const systemNode = findSystemNode();

    // Diagnostic info for debugging sandbox mode
    const diag = {
      execPath: process.execPath,
      cwd: process.cwd(),
      bundledCli: bundledCli || null,
      systemNode: systemNode || null,
      systemCli: claudePath || null,
      expandedPath: getExpandedPath().split(':').slice(0, 5).join(':'),
    };

    // Prefer bundled CLI (sandbox mode) over system CLI
    if (bundledCli) {
      // Read version from SDK package.json on disk (require.resolve is broken by webpack)
      const sdkPkgPath = path.join(path.dirname(bundledCli), 'package.json');
      try {
        const sdkMeta = JSON.parse(fs.readFileSync(sdkPkgPath, 'utf-8'));
        return NextResponse.json({
          connected: true,
          version: sdkMeta.claudeCodeVersion || 'bundled',
          bundled: true,
          diag,
        });
      } catch { /* fall through to system CLI check */ }
    }

    if (claudePath) {
      const version = await getClaudeVersion(claudePath);
      return NextResponse.json({ connected: !!version, version, diag });
    }

    return NextResponse.json({ connected: false, version: null, diag });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      version: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
