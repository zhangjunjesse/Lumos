import { NextResponse } from 'next/server';
import { getClaudeConfigDir } from '@/lib/platform';
import fs from 'fs';
import path from 'path';

function findBundledCliPath(): string | undefined {
  const cwdCandidate = path.join(
    process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
  );
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;

  try {
    const sdkPkg = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    if (typeof sdkPkg === 'string' && sdkPkg.includes('claude-agent-sdk')) {
      const cliPath = path.join(path.dirname(sdkPkg), 'cli.js');
      if (fs.existsSync(cliPath)) return cliPath;
    }
  } catch {
    // SDK not resolvable in current runtime
  }

  return undefined;
}

export async function GET() {
  try {
    const bundledCli = findBundledCliPath();
    const configDir = getClaudeConfigDir();

    if (!bundledCli) {
      return NextResponse.json({
        connected: false,
        version: null,
        sdkVersion: null,
        runtimeSource: 'bundled',
        sandboxed: true,
        configDir,
      });
    }

    const sdkPkgPath = path.join(path.dirname(bundledCli), 'package.json');
    try {
      const sdkMeta = JSON.parse(fs.readFileSync(sdkPkgPath, 'utf-8')) as {
        version?: string;
        claudeCodeVersion?: string;
      };
      return NextResponse.json({
        connected: true,
        version: sdkMeta.claudeCodeVersion || 'bundled',
        sdkVersion: sdkMeta.version || null,
        runtimeSource: 'bundled',
        sandboxed: true,
        configDir,
      });
    } catch {
      return NextResponse.json({
        connected: true,
        version: 'bundled',
        sdkVersion: null,
        runtimeSource: 'bundled',
        sandboxed: true,
        configDir,
      });
    }
  } catch (err) {
    return NextResponse.json({
      connected: false,
      version: null,
      sdkVersion: null,
      runtimeSource: 'bundled',
      sandboxed: true,
      configDir: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
