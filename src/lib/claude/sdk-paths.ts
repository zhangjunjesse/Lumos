import fs from 'fs'
import path from 'path'

// SDK 0.3.x 起 npm 主包只剩 sdk.mjs 薄壳,Claude Code 运行时改为平台原生二进制,
// 随 @anthropic-ai/claude-agent-sdk-<platform>-<arch> 平台包分发(win32 是 claude.exe)。
// 打包产物必须把当前目标架构的平台包一起带进 standalone/node_modules(见 electron-builder.yml
// 与 scripts/ensure-agent-sdk-binary.mjs),否则这里找不到会退回系统 claude。
const SDK_PLATFORM_PACKAGE_DIR = `claude-agent-sdk-${process.platform}-${process.arch}`
const SDK_BINARY_NAME = process.platform === 'win32' ? 'claude.exe' : 'claude'
const SDK_CLI_RELATIVE_PATH = path.join('node_modules', '@anthropic-ai', SDK_PLATFORM_PACKAGE_DIR, SDK_BINARY_NAME)

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
