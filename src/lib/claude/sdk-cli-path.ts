import fs from 'fs'
import path from 'path'

export interface ClaudeSdkPackageMeta {
  version?: string
  claudeCodeVersion?: string
}

function getCandidateRoots(): string[] {
  const execDir = path.dirname(process.execPath)
  const roots = [
    process.cwd(),
    process.resourcesPath,
    execDir,
    path.join(execDir, 'resources'),
    path.resolve(process.cwd(), '..'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  return [...new Set(roots)]
}

export function findBundledClaudeSdkCliPath(): string | undefined {
  for (const root of getCandidateRoots()) {
    const cliPath = path.join(
      root,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
      'cli.js',
    )

    if (fs.existsSync(cliPath)) {
      return cliPath
    }
  }

  return undefined
}

export function readClaudeSdkPackageMeta(cliPath: string): ClaudeSdkPackageMeta | null {
  const sdkPkgPath = path.join(path.dirname(cliPath), 'package.json')

  try {
    return JSON.parse(fs.readFileSync(sdkPkgPath, 'utf-8')) as ClaudeSdkPackageMeta
  } catch {
    return null
  }
}
