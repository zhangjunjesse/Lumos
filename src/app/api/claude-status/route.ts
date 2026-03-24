import { NextResponse } from 'next/server';
import { findBundledClaudeSdkCliPath } from '@/lib/claude/sdk-paths';
import { getClaudeConfigDir } from '@/lib/platform';
import fs from 'fs';
import path from 'path';

function findBundledCliPath(): string | undefined {
  return findBundledClaudeSdkCliPath();
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
