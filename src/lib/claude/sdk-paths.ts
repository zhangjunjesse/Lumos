import fs from 'fs'
import path from 'path'

const SDK_CLI_RELATIVE_PATH = path.join('node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')

function addCandidateRoot(roots: Set<string>, root?: string | null): void {
  if (!root) {
    return
  }

  const trimmed = root.trim()
  if (!trimmed) {
    return
  }

  roots.add(path.resolve(trimmed))
}

function buildCandidateRoots(): string[] {
  const roots = new Set<string>()

  addCandidateRoot(roots, process.cwd())
  addCandidateRoot(roots, process.env.INIT_CWD)
  addCandidateRoot(roots, process.resourcesPath)
  addCandidateRoot(roots, process.resourcesPath ? path.join(process.resourcesPath, 'standalone') : null)
  addCandidateRoot(roots, path.dirname(process.execPath))
  addCandidateRoot(roots, process.execPath ? path.join(path.dirname(process.execPath), '..', 'Resources') : null)

  const mainFilename = typeof require === 'function' ? require.main?.filename : undefined
  if (typeof mainFilename === 'string' && mainFilename.length > 0) {
    addCandidateRoot(roots, path.dirname(mainFilename))
  }

  return Array.from(roots)
}

function findCliFromRoot(root: string): string | undefined {
  let current = path.resolve(root)

  while (true) {
    const candidate = path.join(current, SDK_CLI_RELATIVE_PATH)
    if (fs.existsSync(candidate)) {
      return candidate
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

export function findBundledClaudeSdkCliPath(): string | undefined {
  for (const root of buildCandidateRoots()) {
    const cliPath = findCliFromRoot(root)
    if (cliPath) {
      return cliPath
    }
  }

  return undefined
}
